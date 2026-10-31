const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const pool = require("./db");
const { evaluateTriage } = require("./triage");

const app = express();
const PORT = process.env.PORT || 5000;

// Demo GPS simulation
const ENABLE_DEMO_GPS = process.env.ENABLE_DEMO_GPS === "true";
const GPS_UPDATE_INTERVAL = 1000;
const DEMO_SPEED_METERS_PER_SECOND = 12;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function normalize(value) {
    return String(value || "").trim().toLowerCase();
}

function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const earthRadiusKm = 6371;

    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) ** 2;

    const safeA = Math.max(0, Math.min(1, a));

    return 2 * earthRadiusKm * Math.atan2(
        Math.sqrt(safeA),
        Math.sqrt(1 - safeA)
    );
}

function validCoordinates(latitude, longitude) {
    return (
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180
    );
}

function toStringArray(value) {
    if (Array.isArray(value)) {
        return value.filter(item => typeof item === "string");
    }

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);

            if (Array.isArray(parsed)) {
                return parsed.filter(item => typeof item === "string");
            }
        } catch (error) {
            return value.trim() ? [value] : [];
        }
    }

    return [];
}

function isValidStringArray(value) {
    return Array.isArray(value) &&
        value.every(item => typeof item === "string");
}

function isTerminalStatus(status) {
    return ["completed", "cancelled"].includes(normalize(status));
}

function generateRequestId() {
    return "MR-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

// ==========================================
// ROAD ROUTING USING OSRM
// ==========================================

async function getRoadRoute(
    startLatitude,
    startLongitude,
    endLatitude,
    endLongitude
) {
    const coordinates =
        `${startLongitude},${startLatitude};${endLongitude},${endLatitude}`;

    const url =
        `https://router.project-osrm.org/route/v1/driving/${coordinates}` +
        `?overview=false&steps=false`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
        const response = await fetch(url, {
            method: "GET",
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`OSRM returned HTTP ${response.status}`);
        }

        const data = await response.json();

        if (
            data.code !== "Ok" ||
            !Array.isArray(data.routes) ||
            data.routes.length === 0
        ) {
            throw new Error("No drivable road route found.");
        }

        const route = data.routes[0];

        return {
            distanceKm: Number((route.distance / 1000).toFixed(2)),
            durationMinutes: Number((route.duration / 60).toFixed(1))
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function getRoadRoutePath(
    startLatitude,
    startLongitude,
    endLatitude,
    endLongitude
) {
    const coordinates =
        `${startLongitude},${startLatitude};${endLongitude},${endLatitude}`;

    const url =
        `https://router.project-osrm.org/route/v1/driving/${coordinates}` +
        `?overview=full&geometries=geojson&steps=false`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(url, {
            method: "GET",
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`OSRM returned HTTP ${response.status}`);
        }

        const data = await response.json();

        if (
            data.code !== "Ok" ||
            !Array.isArray(data.routes) ||
            data.routes.length === 0
        ) {
            throw new Error("No road route found for demo GPS.");
        }

        const route = data.routes[0];
        const rawCoordinates = route.geometry.coordinates;

        if (!Array.isArray(rawCoordinates) || rawCoordinates.length < 2) {
            throw new Error("OSRM returned insufficient route coordinates.");
        }

        const points = rawCoordinates.map(coordinate => ({
            longitude: Number(coordinate[0]),
            latitude: Number(coordinate[1])
        }));

        const cumulativeDistances = [0];
        let totalDistance = 0;

        for (let i = 1; i < points.length; i++) {
            const distance = calculateDistance(
                points[i - 1].latitude,
                points[i - 1].longitude,
                points[i].latitude,
                points[i].longitude
            ) * 1000;

            totalDistance += distance;
            cumulativeDistances.push(totalDistance);
        }

        if (totalDistance <= 0) {
            throw new Error("Invalid road route distance.");
        }

        return {
            points,
            cumulativeDistances,
            totalDistance,
            destinationLatitude: endLatitude,
            destinationLongitude: endLongitude
        };
    } finally {
        clearTimeout(timeout);
    }
}

function getPositionOnRoute(route, distanceMeters) {
    const distances = route.cumulativeDistances;
    const points = route.points;

    if (distanceMeters <= 0) {
        return points[0];
    }

    if (distanceMeters >= route.totalDistance) {
        return points[points.length - 1];
    }

    let low = 0;
    let high = distances.length - 1;

    while (low < high) {
        const mid = Math.floor((low + high) / 2);

        if (distances[mid] < distanceMeters) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }

    const nextIndex = low;
    const previousIndex = nextIndex - 1;

    const segmentStart = distances[previousIndex];
    const segmentEnd = distances[nextIndex];
    const segmentLength = segmentEnd - segmentStart;

    const ratio = segmentLength > 0
        ? (distanceMeters - segmentStart) / segmentLength
        : 0;

    return {
        latitude:
            points[previousIndex].latitude +
            (points[nextIndex].latitude - points[previousIndex].latitude) * ratio,

        longitude:
            points[previousIndex].longitude +
            (points[nextIndex].longitude - points[previousIndex].longitude) * ratio
    };
}

// ==========================================
// HOME
// ==========================================

app.get("/", function (req, res) {
    res.json({
        message: "MediRoute backend is running!",
        demoGpsEnabled: ENABLE_DEMO_GPS
    });
});

// ==========================================
// 1. SUBMIT EMERGENCY REQUEST
// ==========================================

app.post("/api/emergency", async function (req, res) {
    const {
        patientName,
        contactNumber,
        emergencyType,
        patientCondition,
        location
    } = req.body;

    if (
        typeof patientName !== "string" ||
        !patientName.trim() ||
        typeof contactNumber !== "string" ||
        !contactNumber.trim() ||
        typeof emergencyType !== "string" ||
        !emergencyType.trim() ||
        typeof location !== "string" ||
        !location.trim()
    ) {
        return res.status(400).json({
            message: "Please provide all required emergency details."
        });
    }

    const triage = evaluateTriage(
        emergencyType.trim(),
        patientCondition || ""
    );

    try {
        let result;
        let requestId;

        for (let attempt = 0; attempt < 3; attempt++) {
            requestId = generateRequestId();

            try {
                result = await pool.query(
                    `INSERT INTO emergency_requests
                    (
                        request_id, patient_name, contact_number,
                        emergency_type, patient_condition, location,
                        status, priority_level, triage_summary
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, 'Received', $7, $8)
                    RETURNING request_id`,
                    [
                        requestId,
                        patientName.trim(),
                        contactNumber.trim(),
                        emergencyType.trim(),
                        patientCondition
                            ? String(patientCondition).trim()
                            : null,
                        location.trim(),
                        triage.priorityLevel,
                        triage.triageSummary
                    ]
                );

                break;
            } catch (error) {
                if (error.code === "23505" && attempt < 2) {
                    continue;
                }

                throw error;
            }
        }

        if (!result || result.rows.length === 0) {
            throw new Error("Could not generate a unique request ID.");
        }

        return res.status(201).json({
            message: "Emergency request received successfully!",
            requestId,
            patientName: patientName.trim(),
            emergencyType: emergencyType.trim(),
            patientCondition: patientCondition || "Unknown",
            location: location.trim(),
            status: "Received",
            priorityLevel: triage.priorityLevel,
            priorityCode: triage.priorityCode,
            priorityColor: triage.color,
            triageSummary: triage.triageSummary
        });
    } catch (error) {
        console.error("Emergency insert failed:", error.message);

        return res.status(500).json({
            message: "Could not save emergency request. Please try again."
        });
    }
});

// ==========================================
// 2. TRACK EMERGENCY REQUEST
// ==========================================

app.get("/api/emergency/:requestId", async function (req, res) {
    try {
        const result = await pool.query(
            `SELECT
                e.request_id,
                e.patient_name,
                e.contact_number,
                e.emergency_type,
                e.patient_condition,
                e.location,
                e.status,
                e.created_at,
                e.priority_level,
                e.triage_summary,
                e.patient_latitude,
                e.patient_longitude,
                e.dispatch_distance_km AS "distanceKm",
                e.estimated_duration_minutes AS "estimatedDurationMinutes",
                h.id AS selected_hospital_id,
                h.name AS selected_hospital_name,
                h.address AS selected_hospital_address,
                h.latitude AS selected_hospital_latitude,
                h.longitude AS selected_hospital_longitude,
                h.phone AS selected_hospital_phone,
                s.selected_at AS hospital_selected_at,
                a.id AS assigned_ambulance_id,
                a.ambulance_number,
                a.driver_name,
                a.driver_phone,
                a.ambulance_type,
                a.latitude AS ambulance_latitude,
                a.longitude AS ambulance_longitude,
                a.status AS ambulance_status
             FROM emergency_requests e
             LEFT JOIN emergency_hospital_selections s
                ON s.request_id = e.request_id
             LEFT JOIN hospitals h
                ON h.id = s.hospital_id
             LEFT JOIN ambulances a
                ON a.id = e.ambulance_id
             WHERE e.request_id = $1`,
            [req.params.requestId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: "Emergency request not found."
            });
        }

        return res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error("Request tracking failed:", error.message);

        return res.status(500).json({
            message: "Could not fetch emergency request."
        });
    }
});

// ==========================================
// 3. CONFIRM OR CHANGE SELECTED HOSPITAL
// ==========================================

app.post("/api/emergency/:requestId/hospital", async function (req, res) {
    const hospitalId = Number(req.body.hospitalId);
    const requestId = req.params.requestId;

    if (!Number.isInteger(hospitalId) || hospitalId <= 0) {
        return res.status(400).json({
            message: "A valid hospital ID is required."
        });
    }

    let client;

    try {
        client = await pool.connect();
        await client.query("BEGIN");

        const requestResult = await client.query(
            `SELECT request_id, status, ambulance_id
             FROM emergency_requests
             WHERE request_id = $1
             FOR UPDATE`,
            [requestId]
        );

        if (requestResult.rows.length === 0) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                message: "Emergency request not found."
            });
        }

        const emergency = requestResult.rows[0];

        if (isTerminalStatus(emergency.status)) {
            await client.query("ROLLBACK");

            return res.status(409).json({
                message: "Hospital cannot be changed for a completed or cancelled emergency."
            });
        }

        if (emergency.ambulance_id !== null) {
            await client.query("ROLLBACK");

            return res.status(409).json({
                message: "Hospital cannot be changed after ambulance assignment."
            });
        }

        const hospitalResult = await client.query(
            `SELECT id, name, address, latitude, longitude, phone
             FROM hospitals
             WHERE id = $1 AND is_verified = TRUE`,
            [hospitalId]
        );

        if (hospitalResult.rows.length === 0) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                message: "Verified hospital not found."
            });
        }

        await client.query(
            `INSERT INTO emergency_hospital_selections
                (request_id, hospital_id, selected_at)
             VALUES ($1, $2, CURRENT_TIMESTAMP)
             ON CONFLICT (request_id)
             DO UPDATE SET
                hospital_id = EXCLUDED.hospital_id,
                selected_at = CURRENT_TIMESTAMP`,
            [requestId, hospitalId]
        );

        await client.query(
            `UPDATE emergency_requests
             SET status = 'Hospital Confirmed'
             WHERE request_id = $1`,
            [requestId]
        );

        await client.query("COMMIT");

        return res.status(200).json({
            message: "Hospital selection confirmed successfully!",
            requestId,
            status: "Hospital Confirmed",
            hospital: hospitalResult.rows[0]
        });
    } catch (error) {
        if (client) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Rollback failed:", rollbackError.message);
            }
        }

        console.error("Hospital confirmation failed:", error.message);

        return res.status(500).json({
            message: "Could not confirm the selected hospital."
        });
    } finally {
        if (client) client.release();
    }
});

// ==========================================
// 4. UPDATE EMERGENCY STATUS
// ==========================================

app.patch("/api/emergency/:requestId/status", async function (req, res) {
    const requestId = req.params.requestId;
    const status = req.body.status;

    const allowedStatuses = [
        "Received",
        "Hospital Confirmed",
        "Ambulance Assigned",
        "Dispatched",
        "Arrived",
        "Completed",
        "Cancelled"
    ];

    if (
        typeof status !== "string" ||
        !allowedStatuses.includes(status)
    ) {
        return res.status(400).json({
            message: "Invalid status. Allowed statuses are: " +
                allowedStatuses.join(", ")
        });
    }

    let client;

    try {
        client = await pool.connect();
        await client.query("BEGIN");

        const requestResult = await client.query(
            `SELECT request_id, status, ambulance_id
             FROM emergency_requests
             WHERE request_id = $1
             FOR UPDATE`,
            [requestId]
        );

        if (requestResult.rows.length === 0) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                message: "Emergency request not found."
            });
        }

        const emergency = requestResult.rows[0];

        if (isTerminalStatus(emergency.status)) {
            await client.query("ROLLBACK");

            return res.status(409).json({
                message: "This emergency is already completed or cancelled."
            });
        }

        if (
            ["Ambulance Assigned", "Dispatched", "Arrived"].includes(status) &&
            emergency.ambulance_id === null
        ) {
            await client.query("ROLLBACK");

            return res.status(409).json({
                message: "An ambulance must be assigned before this status."
            });
        }

        if (
            ["Ambulance Assigned", "Dispatched", "Arrived"].includes(status)
        ) {
            const hospitalCheck = await client.query(
                `SELECT request_id
                 FROM emergency_hospital_selections
                 WHERE request_id = $1`,
                [requestId]
            );

            if (hospitalCheck.rows.length === 0) {
                await client.query("ROLLBACK");

                return res.status(409).json({
                    message: "A hospital must be confirmed first."
                });
            }
        }

        const updateResult = await client.query(
            `UPDATE emergency_requests
             SET status = $1
             WHERE request_id = $2
             RETURNING request_id, status, created_at, ambulance_id`,
            [status, requestId]
        );

        if (
            ["Completed", "Cancelled"].includes(status) &&
            emergency.ambulance_id !== null
        ) {
            await client.query(
                `UPDATE ambulances
                 SET status = 'Available'
                 WHERE id = $1
                   AND is_active = TRUE
                   AND NOT EXISTS (
                       SELECT 1
                       FROM emergency_requests e
                       WHERE e.ambulance_id = $1
                         AND e.request_id <> $2
                         AND e.status NOT IN ('Completed', 'Cancelled')
                   )`,
                [emergency.ambulance_id, requestId]
            );
        }

        await client.query("COMMIT");

        return res.status(200).json({
            message: "Emergency status updated successfully.",
            emergency: updateResult.rows[0]
        });
    } catch (error) {
        if (client) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Rollback failed:", rollbackError.message);
            }
        }

        console.error("Emergency status update failed:", error.message);

        return res.status(500).json({
            message: "Could not update emergency status."
        });
    } finally {
        if (client) client.release();
    }
});

// ==========================================
// 5. GET ALL ACTIVE AMBULANCES
// ==========================================

app.get("/api/ambulances", async function (req, res) {
    try {
        const result = await pool.query(
            `SELECT
                id, ambulance_number, driver_name, driver_phone,
                ambulance_type, latitude, longitude, status
             FROM ambulances
             WHERE is_active = TRUE
             ORDER BY
                CASE
                    WHEN LOWER(TRIM(status)) = 'available' THEN 0
                    ELSE 1
                END,
                id ASC`
        );

        return res.status(200).json({
            count: result.rows.length,
            ambulances: result.rows
        });
    } catch (error) {
        console.error("Ambulance fetch failed:", error.message);

        return res.status(500).json({
            message: "Could not fetch ambulances."
        });
    }
});

// ==========================================
// 6. SMART AMBULANCE DISPATCH
// Ambulance starts from SELECTED HOSPITAL
// ==========================================

app.post("/api/emergency/:requestId/ambulance", async function (req, res) {
    const requestId = req.params.requestId;

    const latitudeProvided = req.body.latitude !== undefined;
    const longitudeProvided = req.body.longitude !== undefined;

    const patientLatitude = Number(req.body.latitude);
    const patientLongitude = Number(req.body.longitude);

    const manualAmbulanceId =
        req.body.ambulanceId === undefined
            ? null
            : Number(req.body.ambulanceId);

    const automaticDispatch = req.body.ambulanceId === undefined;

    if (
        !latitudeProvided ||
        !longitudeProvided ||
        !validCoordinates(patientLatitude, patientLongitude)
    ) {
        return res.status(400).json({
            message: "Valid patient GPS latitude and longitude are required for ambulance dispatch."
        });
    }

    if (
        !automaticDispatch &&
        (
            !Number.isInteger(manualAmbulanceId) ||
            manualAmbulanceId <= 0
        )
    ) {
        return res.status(400).json({
            message: "Provide a valid ambulance ID for manual assignment."
        });
    }

    let client;

    try {
        client = await pool.connect();
        await client.query("BEGIN");

        const requestResult = await client.query(
            `SELECT request_id, status, ambulance_id
             FROM emergency_requests
             WHERE request_id = $1
             FOR UPDATE`,
            [requestId]
        );

        if (requestResult.rows.length === 0) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                message: "Emergency request not found."
            });
        }

        const emergency = requestResult.rows[0];

        if (isTerminalStatus(emergency.status)) {
            await client.query("ROLLBACK");

            return res.status(409).json({
                message: "Cannot assign an ambulance to a completed or cancelled emergency."
            });
        }

        if (emergency.ambulance_id !== null) {
            await client.query("ROLLBACK");

            return res.status(409).json({
                message: "An ambulance is already assigned to this emergency."
            });
        }

        // Get the confirmed hospital and its coordinates.
        const hospitalResult = await client.query(
            `SELECT
                h.id,
                h.name,
                h.latitude,
                h.longitude
             FROM emergency_hospital_selections s
             INNER JOIN hospitals h ON h.id = s.hospital_id
             WHERE s.request_id = $1`,
            [requestId]
        );

        if (hospitalResult.rows.length === 0) {
            await client.query("ROLLBACK");

            return res.status(409).json({
                message: "Please confirm a hospital before assigning an ambulance."
            });
        }

        const selectedHospital = hospitalResult.rows[0];

        const hospitalLatitude = Number(selectedHospital.latitude);
        const hospitalLongitude = Number(selectedHospital.longitude);

        if (!validCoordinates(hospitalLatitude, hospitalLongitude)) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                message: "The selected hospital does not have valid GPS coordinates."
            });
        }

        let ambulance;
        let distanceKm = null;
        let estimatedDurationMinutes = null;

        // ======================================
        // AUTOMATIC DISPATCH
        // Route is calculated from hospital to patient.
        // ======================================

        if (automaticDispatch) {
            const availableResult = await client.query(
                `SELECT
                    id, ambulance_number, driver_name, driver_phone,
                    ambulance_type, latitude, longitude, status
                 FROM ambulances
                 WHERE is_active = TRUE
                   AND LOWER(TRIM(status)) = 'available'
                 ORDER BY id ASC
                 FOR UPDATE SKIP LOCKED`
            );

            if (availableResult.rows.length === 0) {
                await client.query("ROLLBACK");

                return res.status(404).json({
                    message: "No available ambulance was found."
                });
            }

            // All demo ambulances are dispatched from the confirmed
            // hospital, so calculate the road route from that hospital.
            const route = await getRoadRoute(
                hospitalLatitude,
                hospitalLongitude,
                patientLatitude,
                patientLongitude
            );

            distanceKm = route.distanceKm;
            estimatedDurationMinutes = route.durationMinutes;

            // No hospital-to-ambulance association exists in the current
            // database schema. Select the first available ambulance.
            ambulance = availableResult.rows[0];

        } else {
            const ambulanceResult = await client.query(
                `SELECT
                    id, ambulance_number, driver_name, driver_phone,
                    ambulance_type, latitude, longitude, status
                 FROM ambulances
                 WHERE id = $1 AND is_active = TRUE
                 FOR UPDATE`,
                [manualAmbulanceId]
            );

            if (ambulanceResult.rows.length === 0) {
                await client.query("ROLLBACK");

                return res.status(404).json({
                    message: "Active ambulance not found."
                });
            }

            ambulance = ambulanceResult.rows[0];

            if (normalize(ambulance.status) !== "available") {
                await client.query("ROLLBACK");

                return res.status(409).json({
                    message: "This ambulance is not available.",
                    ambulanceStatus: ambulance.status
                });
            }

            try {
                const route = await getRoadRoute(
                    hospitalLatitude,
                    hospitalLongitude,
                    patientLatitude,
                    patientLongitude
                );

                distanceKm = route.distanceKm;
                estimatedDurationMinutes = route.durationMinutes;
            } catch (error) {
                console.error("Manual dispatch route failed:", error.message);
            }
        }

        if (normalize(ambulance.status) !== "available") {
            await client.query("ROLLBACK");

            return res.status(409).json({
                message: "Selected ambulance is no longer available."
            });
        }

        // IMPORTANT:
        // Set the ambulance's initial demo location to the selected hospital.
        // The live GPS simulation will then move it from hospital to patient.
        await client.query(
            `UPDATE ambulances
             SET status = 'Assigned',
                 latitude = $1,
                 longitude = $2
             WHERE id = $3`,
            [
                hospitalLatitude,
                hospitalLongitude,
                ambulance.id
            ]
        );

        const updateResult = await client.query(
            `UPDATE emergency_requests
             SET ambulance_id = $1,
                 status = 'Ambulance Assigned',
                 dispatch_distance_km = $2,
                 estimated_duration_minutes = $3,
                 patient_latitude = $5,
                 patient_longitude = $6
             WHERE request_id = $4
             RETURNING
                request_id, status, ambulance_id,
                patient_latitude, patient_longitude,
                dispatch_distance_km, estimated_duration_minutes`,
            [
                ambulance.id,
                distanceKm,
                estimatedDurationMinutes,
                requestId,
                patientLatitude,
                patientLongitude
            ]
        );

        await client.query("COMMIT");

        return res.status(200).json({
            message: "Ambulance assigned successfully!",
            dispatchMode: automaticDispatch
                ? "Automatic - Hospital to Patient Road ETA"
                : "Manual - Hospital to Patient Road ETA",
            emergency: updateResult.rows[0],
            ambulance: {
                id: ambulance.id,
                ambulanceNumber: ambulance.ambulance_number,
                driverName: ambulance.driver_name,
                driverPhone: ambulance.driver_phone,
                ambulanceType: ambulance.ambulance_type,

                // Return hospital coordinates as the starting location.
                latitude: hospitalLatitude,
                longitude: hospitalLongitude,

                status: "Assigned",
                distanceKm,
                estimatedDurationMinutes
            },
            startingLocation: {
                name: selectedHospital.name,
                latitude: hospitalLatitude,
                longitude: hospitalLongitude
            },
            patientLocation: {
                latitude: patientLatitude,
                longitude: patientLongitude
            }
        });
    } catch (error) {
        if (client) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error(
                    "Assignment rollback failed:",
                    rollbackError.message
                );
            }
        }

        console.error("Smart ambulance dispatch failed:", error.message);

        return res.status(500).json({
            message: "Could not assign ambulance."
        });
    } finally {
        if (client) client.release();
    }
});

// ==========================================
// 7. UPDATE AMBULANCE LIVE LOCATION
// ==========================================

app.patch("/api/ambulances/:ambulanceId/location", async function (req, res) {
    const ambulanceId = Number(req.params.ambulanceId);
    const latitude = Number(req.body.latitude);
    const longitude = Number(req.body.longitude);

    if (!Number.isInteger(ambulanceId) || ambulanceId <= 0) {
        return res.status(400).json({
            message: "Invalid ambulance ID."
        });
    }

    if (
        req.body.latitude === undefined ||
        req.body.longitude === undefined ||
        !validCoordinates(latitude, longitude)
    ) {
        return res.status(400).json({
            message: "Valid latitude and longitude are required."
        });
    }

    try {
        const result = await pool.query(
            `UPDATE ambulances
             SET latitude = $1, longitude = $2
             WHERE id = $3 AND is_active = TRUE
             RETURNING
                id, ambulance_number, driver_name,
                latitude, longitude, status`,
            [latitude, longitude, ambulanceId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: "Active ambulance not found."
            });
        }

        return res.status(200).json({
            message: "Ambulance location updated successfully!",
            ambulance: result.rows[0]
        });
    } catch (error) {
        console.error("Ambulance location update failed:", error.message);

        return res.status(500).json({
            message: "Could not update ambulance location."
        });
    }
});

// ==========================================
// 8. ADD A HOSPITAL
// ==========================================

app.post("/api/hospitals", async function (req, res) {
    const {
        name, address, latitude, longitude,
        phone, facilities, emergencyTypes
    } = req.body;

    if (
        typeof name !== "string" ||
        !name.trim() ||
        typeof address !== "string" ||
        !address.trim() ||
        latitude === undefined ||
        longitude === undefined
    ) {
        return res.status(400).json({
            message: "Hospital name, address, latitude and longitude are required."
        });
    }

    const lat = Number(latitude);
    const lon = Number(longitude);

    if (!validCoordinates(lat, lon)) {
        return res.status(400).json({
            message: "Invalid hospital coordinates."
        });
    }

    if (
        (facilities !== undefined && !isValidStringArray(facilities)) ||
        (emergencyTypes !== undefined &&
            !isValidStringArray(emergencyTypes))
    ) {
        return res.status(400).json({
            message: "Facilities and emergencyTypes must be arrays of strings."
        });
    }

    try {
        const result = await pool.query(
            `INSERT INTO hospitals
            (
                name, address, latitude, longitude, phone,
                facilities, emergency_types, is_verified
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
            RETURNING
                id, name, address, latitude, longitude,
                phone, facilities, emergency_types, is_verified`,
            [
                name.trim(),
                address.trim(),
                lat,
                lon,
                phone ? String(phone).trim() : null,
                facilities || [],
                emergencyTypes || []
            ]
        );

        return res.status(201).json({
            message: "Hospital added successfully. Verification is pending.",
            hospital: result.rows[0]
        });
    } catch (error) {
        console.error("Hospital insert failed:", error.message);

        return res.status(500).json({
            message: "Could not save hospital."
        });
    }
});

// ==========================================
// 9. GET ALL VERIFIED HOSPITALS
// ==========================================

app.get("/api/hospitals", async function (req, res) {
    try {
        const result = await pool.query(
            `SELECT
                id, name, address, latitude, longitude,
                phone, facilities, emergency_types, is_verified
             FROM hospitals
             WHERE is_verified = TRUE
             ORDER BY name ASC`
        );

        return res.status(200).json({
            count: result.rows.length,
            hospitals: result.rows
        });
    } catch (error) {
        console.error("Hospital fetch failed:", error.message);

        return res.status(500).json({
            message: "Could not fetch hospitals."
        });
    }
});

// ==========================================
// 10. FIND NEARBY VERIFIED HOSPITALS
// ==========================================

app.get("/api/hospitals/nearby", async function (req, res) {
    const latitude = req.query.latitude;
    const longitude = req.query.longitude;
    const radiusKm = req.query.radiusKm;
    const emergencyType = req.query.emergencyType;

    const lat = Number(latitude);
    const lon = Number(longitude);

    const radius =
        radiusKm === undefined ? 25 : Number(radiusKm);

    if (
        latitude === undefined ||
        longitude === undefined ||
        !validCoordinates(lat, lon)
    ) {
        return res.status(400).json({
            message: "Valid latitude and longitude are required."
        });
    }

    if (
        !Number.isFinite(radius) ||
        radius <= 0 ||
        radius > 500
    ) {
        return res.status(400).json({
            message: "radiusKm must be greater than 0 and at most 500."
        });
    }

    try {
        const result = await pool.query(
            `SELECT
                id, name, address, latitude, longitude,
                phone, facilities, emergency_types, is_verified
             FROM hospitals
             WHERE is_verified = TRUE`
        );

        const requestedEmergency = normalize(emergencyType);

        const nearby = result.rows
            .filter(hospital =>
                validCoordinates(
                    Number(hospital.latitude),
                    Number(hospital.longitude)
                )
            )
            .map(hospital => {
                const hospitalLat = Number(hospital.latitude);
                const hospitalLon = Number(hospital.longitude);

                const distanceKm = calculateDistance(
                    lat, lon, hospitalLat, hospitalLon
                );

                const supportedEmergencyTypes = toStringArray(
                    hospital.emergency_types
                );

                const matchesEmergency =
                    !requestedEmergency ||
                    supportedEmergencyTypes.some(type =>
                        normalize(type) === requestedEmergency
                    );

                return {
                    ...hospital,
                    latitude: hospitalLat,
                    longitude: hospitalLon,
                    facilities: toStringArray(hospital.facilities),
                    emergency_types: supportedEmergencyTypes,
                    distanceKm: Number(distanceKm.toFixed(2)),
                    matchesEmergency
                };
            })
            .filter(hospital => hospital.distanceKm <= radius);

        const hospitals = await Promise.all(
            nearby.map(async function (hospital) {
                try {
                    const route = await getRoadRoute(
                        lat,
                        lon,
                        hospital.latitude,
                        hospital.longitude
                    );

                    return {
                        ...hospital,
                        roadDistanceKm: route.distanceKm,
                        roadDurationMinutes: route.durationMinutes
                    };
                } catch (error) {
                    console.error(
                        `Road distance failed for hospital ${hospital.id}:`,
                        error.message
                    );

                    return {
                        ...hospital,
                        roadDistanceKm: null,
                        roadDurationMinutes: null
                    };
                }
            })
        );

        hospitals.sort((a, b) => {
            if (a.matchesEmergency !== b.matchesEmergency) {
                return a.matchesEmergency ? -1 : 1;
            }

            const distanceA = a.roadDistanceKm ?? a.distanceKm;
            const distanceB = b.roadDistanceKm ?? b.distanceKm;

            return distanceA - distanceB;
        });

        return res.status(200).json({
            count: hospitals.length,
            searchRadiusKm: radius,
            requestedEmergencyType: emergencyType || null,
            hospitals
        });
    } catch (error) {
        console.error("Nearby hospital search failed:", error.message);

        return res.status(500).json({
            message: "Could not find nearby hospitals."
        });
    }
});

// ==========================================
// 11. ROAD-BASED DEMO GPS SIMULATION
// Hospital → Patient → Selected Hospital
// ==========================================

const demoRoutes = new Map();
let demoGpsUpdating = false;

async function completeHospitalArrival(
    ambulanceId,
    requestId,
    hospitalLatitude,
    hospitalLongitude
) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        await client.query(
            `UPDATE emergency_requests
             SET status = 'Arrived'
             WHERE request_id = $1
               AND status IN ('Ambulance Assigned', 'Dispatched')`,
            [requestId]
        );

        await client.query(
            `UPDATE ambulances
             SET latitude = $1,
                 longitude = $2,
                 status = 'Available'
             WHERE id = $3
               AND is_active = TRUE`,
            [hospitalLatitude, hospitalLongitude, ambulanceId]
        );

        await client.query("COMMIT");
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error("Arrival rollback failed:", rollbackError.message);
        }

        throw error;
    } finally {
        client.release();
    }
}

async function updateDemoAmbulanceLocations() {
    if (!ENABLE_DEMO_GPS || demoGpsUpdating) return;

    demoGpsUpdating = true;

    try {
        const result = await pool.query(
            `SELECT DISTINCT
                a.id AS ambulance_id,
                a.latitude AS ambulance_latitude,
                a.longitude AS ambulance_longitude,
                a.status AS ambulance_status,
                e.request_id,
                e.status AS emergency_status,
                e.patient_latitude,
                e.patient_longitude,
                h.latitude AS hospital_latitude,
                h.longitude AS hospital_longitude
             FROM ambulances a
             INNER JOIN emergency_requests e
                ON e.ambulance_id = a.id
             INNER JOIN emergency_hospital_selections s
                ON s.request_id = e.request_id
             INNER JOIN hospitals h
                ON h.id = s.hospital_id
             WHERE a.is_active = TRUE
               AND LOWER(TRIM(a.status)) IN ('assigned', 'on duty')
               AND e.status IN ('Ambulance Assigned', 'Dispatched')
               AND a.latitude IS NOT NULL
               AND a.longitude IS NOT NULL
               AND e.patient_latitude IS NOT NULL
               AND e.patient_longitude IS NOT NULL
               AND h.latitude IS NOT NULL
               AND h.longitude IS NOT NULL`
        );

        const activeAmbulanceIds = new Set(
            result.rows.map(row => Number(row.ambulance_id))
        );

        for (const ambulanceId of demoRoutes.keys()) {
            if (!activeAmbulanceIds.has(ambulanceId)) {
                demoRoutes.delete(ambulanceId);
            }
        }

        for (const ambulance of result.rows) {
            const ambulanceId = Number(ambulance.ambulance_id);

            const patientLatitude = Number(ambulance.patient_latitude);
            const patientLongitude = Number(ambulance.patient_longitude);

            const hospitalLatitude = Number(ambulance.hospital_latitude);
            const hospitalLongitude = Number(ambulance.hospital_longitude);

            if (
                !validCoordinates(patientLatitude, patientLongitude) ||
                !validCoordinates(hospitalLatitude, hospitalLongitude)
            ) {
                continue;
            }

            let routeState = demoRoutes.get(ambulanceId);

            // ======================================
            // INITIAL ROUTE: HOSPITAL → PATIENT
            // Always starts from the selected hospital.
            // This also corrects previously assigned
            // demo requests when the server restarts.
            // ======================================

            if (
                !routeState ||
                routeState.requestId !== ambulance.request_id
            ) {
                try {
                    const route = await getRoadRoutePath(
                        hospitalLatitude,
                        hospitalLongitude,
                        patientLatitude,
                        patientLongitude
                    );

                    // Place the ambulance at the selected hospital
                    // before beginning the simulated journey.
                    await pool.query(
                        `UPDATE ambulances
                         SET latitude = $1,
                             longitude = $2
                         WHERE id = $3
                           AND is_active = TRUE`,
                        [
                            hospitalLatitude,
                            hospitalLongitude,
                            ambulanceId
                        ]
                    );

                    demoRoutes.set(ambulanceId, {
                        ...route,
                        requestId: ambulance.request_id,
                        phase: "to_patient",
                        progressMeters: 0,
                        lastUpdateTime: Date.now(),
                        finished: false
                    });

                    console.log(
                        `[DEMO GPS] Ambulance ${ambulanceId}: starting from selected hospital and travelling to patient.`
                    );
                } catch (error) {
                    console.error(
                        `[DEMO GPS] Patient route failed for ambulance ${ambulanceId}:`,
                        error.message
                    );
                }

                continue;
            }

            routeState = demoRoutes.get(ambulanceId);

            if (!routeState || routeState.finished) {
                continue;
            }

            // ======================================
            // RETRY HOSPITAL ROUTE IF FAILED
            // ======================================

            if (routeState.phase === "waiting_for_hospital_route") {
                try {
                    const hospitalRoute = await getRoadRoutePath(
                        patientLatitude,
                        patientLongitude,
                        hospitalLatitude,
                        hospitalLongitude
                    );

                    demoRoutes.set(ambulanceId, {
                        ...hospitalRoute,
                        requestId: ambulance.request_id,
                        phase: "to_hospital",
                        progressMeters: 0,
                        lastUpdateTime: Date.now(),
                        finished: false
                    });

                    console.log(
                        `[DEMO GPS] Ambulance ${ambulanceId}: hospital route started.`
                    );
                } catch (error) {
                    console.error(
                        `[DEMO GPS] Hospital route retry failed for ambulance ${ambulanceId}:`,
                        error.message
                    );
                }

                continue;
            }

            const now = Date.now();

            const elapsedSeconds = Math.max(
                0,
                (now - routeState.lastUpdateTime) / 1000
            );

            routeState.lastUpdateTime = now;

            routeState.progressMeters = Math.min(
                routeState.totalDistance,
                routeState.progressMeters +
                DEMO_SPEED_METERS_PER_SECOND * elapsedSeconds
            );

            const newPosition = getPositionOnRoute(
                routeState,
                routeState.progressMeters
            );

            const reachedDestination =
                routeState.progressMeters >= routeState.totalDistance;

            // ======================================
            // PHASE 1: REACH THE PATIENT
            // ======================================

            if (
                reachedDestination &&
                routeState.phase === "to_patient"
            ) {
                try {
                    await pool.query(
                        `UPDATE ambulances
                         SET latitude = $1,
                             longitude = $2,
                             status = 'On Duty'
                         WHERE id = $3
                           AND is_active = TRUE`,
                        [
                            patientLatitude,
                            patientLongitude,
                            ambulanceId
                        ]
                    );

                    console.log(
                        `[DEMO GPS] Ambulance ${ambulanceId} reached the patient.`
                    );

                    const hospitalRoute = await getRoadRoutePath(
                        patientLatitude,
                        patientLongitude,
                        hospitalLatitude,
                        hospitalLongitude
                    );

                    demoRoutes.set(ambulanceId, {
                        ...hospitalRoute,
                        requestId: ambulance.request_id,
                        phase: "to_hospital",
                        progressMeters: 0,
                        lastUpdateTime: Date.now(),
                        finished: false
                    });

                    console.log(
                        `[DEMO GPS] Ambulance ${ambulanceId}: patient picked up. Travelling to hospital.`
                    );
                } catch (error) {
                    routeState.phase = "waiting_for_hospital_route";
                    routeState.lastUpdateTime = Date.now();

                    console.error(
                        `[DEMO GPS] Hospital route failed for ambulance ${ambulanceId}. Will retry:`,
                        error.message
                    );
                }

                continue;
            }

            // ======================================
            // PHASE 2: REACH THE SELECTED HOSPITAL
            // ======================================

            if (
                reachedDestination &&
                routeState.phase === "to_hospital"
            ) {
                try {
                    await completeHospitalArrival(
                        ambulanceId,
                        ambulance.request_id,
                        hospitalLatitude,
                        hospitalLongitude
                    );

                    routeState.finished = true;

                    console.log(
                        `[DEMO GPS] Ambulance ${ambulanceId} reached the selected hospital. Request ${ambulance.request_id} is Arrived. Ambulance is Available again.`
                    );
                } catch (error) {
                    console.error(
                        `[DEMO GPS] Hospital arrival update failed for ambulance ${ambulanceId}. Will retry:`,
                        error.message
                    );
                }

                continue;
            }

            // Save the current moving location.
            try {
                await pool.query(
                    `UPDATE ambulances
                     SET latitude = $1,
                         longitude = $2
                     WHERE id = $3
                       AND is_active = TRUE`,
                    [
                        newPosition.latitude,
                        newPosition.longitude,
                        ambulanceId
                    ]
                );
            } catch (error) {
                console.error(
                    `[DEMO GPS] Location update failed for ambulance ${ambulanceId}:`,
                    error.message
                );
            }
        }

        if (result.rows.length > 0) {
            console.log(
                `[DEMO GPS] Road tracking updated for ${result.rows.length} ambulance(s).`
            );
        }
    } catch (error) {
        console.error("Demo GPS update failed:", error.message);
    } finally {
        demoGpsUpdating = false;
    }
}

if (ENABLE_DEMO_GPS) {
    console.log("ROAD-BASED DEMO GPS SIMULATION ENABLED");
    console.log("Route: Selected Hospital → Patient → Selected Hospital");

    updateDemoAmbulanceLocations();

    setInterval(
        updateDemoAmbulanceLocations,
        GPS_UPDATE_INTERVAL
    );
} else {
    console.log("Demo GPS simulation is disabled.");
}

// ==========================================
// GLOBAL ERROR HANDLER
// ==========================================

app.use(function (error, req, res, next) {
    console.error("Unhandled server error:", error.message);

    if (res.headersSent) {
        return next(error);
    }

    return res.status(500).json({
        message: "An unexpected server error occurred."
    });
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, function () {
    console.log("MediRoute server running on port " + PORT);
});