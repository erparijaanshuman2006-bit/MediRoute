import { useState, useEffect } from "react";
import L from "leaflet";
import "./App.css";
import "leaflet/dist/leaflet.css";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
} from "react-leaflet";

const API = "http://localhost:5000/api";

// PERSISTENCE FIX: Store only the latest emergency ID in this browser.
const STORAGE_KEY = "mediroute_last_request_id";

const features = [
  { icon: "🚑", title: "Smart Ambulance Dispatch", text: "Automatically select the nearest available ambulance using GPS coordinates." },
  { icon: "🏥", title: "Verified Hospital Matching", text: "Explore nearby hospitals using map and location information." },
  { icon: "🔗", title: "Live Ambulance-to-Hospital Coordination", text: "Bring patients, ambulance teams and hospitals into one workflow." },
  { icon: "🆘", title: "Emergency Request That Works Under Stress", text: "Submit essential emergency details through a simple form." },
  { icon: "✓", title: "Reliable Emergency Status", text: "Show request confirmation and helpful error messages." },
  { icon: "🗺️", title: "Smart Route & Roadblock Alerts", text: "View routes to support journey planning. Roadblock feeds require integration." },
  { icon: "⚕️", title: "Emergency Priority & Triage", text: "Display the priority assigned by the backend triage system." },
  { icon: "📍", title: "Live GPS Tracking", text: "Use GPS to share the emergency location. Live ambulance tracking requires a connected service." },
];

const emergencyTypes = [
  "Chest Pain",
  "Breathing Difficulty",
  "Road Accident",
  "Serious Injury",
  "Other Emergency",
];

const conditions = ["Unconscious", "Injured", "Conscious", "Unknown"];

function getHospitalCategory(type) {
  const categories = {
    "Chest Pain": "Cardiac",
    "Breathing Difficulty": "Medical",
    "Road Accident": "Accident",
    "Serious Injury": "Accident",
    "Other Emergency": "Medical",
  };

  return categories[type] || "";
}

function getHospitalKey(hospital) {
  if (!hospital) return "";

  return hospital.id != null
    ? String(hospital.id)
    : `${hospital.name || ""}-${hospital.latitude}-${hospital.longitude}`;
}

function isValidPosition(latitude, longitude) {
  return (
    latitude !== null &&
    latitude !== undefined &&
    longitude !== null &&
    longitude !== undefined &&
    String(latitude).trim() !== "" &&
    String(longitude).trim() !== "" &&
    Number.isFinite(Number(latitude)) &&
    Number.isFinite(Number(longitude)) &&
    Number(latitude) >= -90 &&
    Number(latitude) <= 90 &&
    Number(longitude) >= -180 &&
    Number(longitude) <= 180
  );
}

function getRoadDistance(hospital) {
  if (!hospital) return null;

  const value = hospital.roadDistanceKm ?? hospital.road_distance_km;

  return value != null && Number.isFinite(Number(value))
    ? Number(value)
    : null;
}

function normalizeAmbulance(data) {
  if (!data) return null;

  const ambulance = data.ambulance || data;

  const id =
    ambulance.id ??
    ambulance.ambulance_id ??
    data.assigned_ambulance_id ??
    data.ambulanceId;

  if (id == null) return null;

  const latitudeValue =
    ambulance.latitude ?? ambulance.ambulance_latitude;

  const longitudeValue =
    ambulance.longitude ?? ambulance.ambulance_longitude;

  const latitude =
    latitudeValue == null ? null : Number(latitudeValue);

  const longitude =
    longitudeValue == null ? null : Number(longitudeValue);

  const ambulanceStatus =
    data.ambulance?.status ??
    data.ambulance_status ??
    data.ambulanceStatus ??
    (data.ambulance ? data.ambulance.status : null) ??
    "Assigned";

  return {
    id,
    ambulanceNumber:
      ambulance.ambulanceNumber ||
      ambulance.ambulance_number ||
      data.ambulance_number ||
      "Not available",

    driverName:
      ambulance.driverName ||
      ambulance.driver_name ||
      data.driver_name ||
      "Not available",

    driverPhone:
      ambulance.driverPhone ||
      ambulance.driver_phone ||
      data.driver_phone ||
      "Not available",

    ambulanceType:
      ambulance.ambulanceType ||
      ambulance.ambulance_type ||
      data.ambulance_type ||
      "Not available",

    latitude: isValidPosition(latitude, longitude)
      ? latitude
      : null,

    longitude: isValidPosition(latitude, longitude)
      ? longitude
      : null,

    status: ambulanceStatus,

    distanceKm:
      ambulance.distanceKm ??
      ambulance.distance_km ??
      data.distanceKm ??
      data.distance_km ??
      null,

    estimatedDurationMinutes:
      ambulance.estimatedDurationMinutes ??
      ambulance.estimated_duration_minutes ??
      data.estimatedDurationMinutes ??
      data.estimated_duration_minutes ??
      null,
  };
}

const patientIcon = L.divIcon({
  className: "mediroute-patient-marker",
  html: '<div style="background:#ef4444;color:white;width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid white;box-shadow:0 2px 10px #0008;display:flex;align-items:center;justify-content:center;"><span style="transform:rotate(45deg);font-size:19px;">●</span></div>',
  iconSize: [34, 34],
  iconAnchor: [17, 34],
});

const hospitalIcon = L.divIcon({
  className: "mediroute-hospital-marker",
  html: '<div style="background:#ffffff;border:2px solid #d62839;border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:24px;box-shadow:0 2px 10px #0007;">🏥</div>',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

const ambulanceIcon = L.divIcon({
  className: "mediroute-ambulance-marker",
  html: '<div style="background:#ffffff;border:2px solid #3b82f6;border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:24px;box-shadow:0 2px 10px #0007;">🚑</div>',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

function EcgLine() {
  return (
    <div className="ecg-overlay" aria-hidden="true">
      <svg
        className="ecg-overlay-svg"
        viewBox="0 0 1440 100"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id="ecg-red-glow" x="-20%" y="-100%" width="140%" height="300%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          className="ecg-base-line"
          d="M0 50 H250 L290 50 L325 12 L360 88 L405 2 L450 98 L495 50 H720 L760 50 L795 12 L830 88 L875 2 L920 98 L965 50 H1190 L1230 50 L1265 12 L1300 88 L1345 2 L1390 98 L1420 50 H1440"
        />
        <path
          className="ecg-moving-line"
          d="M0 50 H250 L290 50 L325 12 L360 88 L405 2 L450 98 L495 50 H720 L760 50 L795 12 L830 88 L875 2 L920 98 L965 50 H1190 L1230 50 L1265 12 L1300 88 L1345 2 L1390 98 L1420 50 H1440"
          filter="url(#ecg-red-glow)"
        />
      </svg>
    </div>
  );
}

function FitMap({ patient, hospital, ambulance }) {
  const map = useMap();

  useEffect(() => {
    const positions = [];

    if (patient && isValidPosition(patient.latitude, patient.longitude)) {
      positions.push([Number(patient.latitude), Number(patient.longitude)]);
    }

    if (ambulance && isValidPosition(ambulance.latitude, ambulance.longitude)) {
      positions.push([Number(ambulance.latitude), Number(ambulance.longitude)]);
    }

    if (hospital && isValidPosition(hospital.latitude, hospital.longitude)) {
      positions.push([Number(hospital.latitude), Number(hospital.longitude)]);
    }

    if (positions.length > 1) {
      map.fitBounds(positions, {
        padding: [45, 45],
        maxZoom: 15,
      });
    } else if (positions.length === 1) {
      map.setView(positions[0], 15);
    }
  }, [
    map,
    patient?.latitude,
    patient?.longitude,
    hospital?.latitude,
    hospital?.longitude,
    ambulance?.id,
  ]);

  return null;
}

function MapView({
  patient,
  hospital,
  ambulance,
  routeCoordinates = [],
}) {
  const patientPosition =
    patient && isValidPosition(patient.latitude, patient.longitude)
      ? [Number(patient.latitude), Number(patient.longitude)]
      : null;

  const ambulancePosition =
    ambulance && isValidPosition(ambulance.latitude, ambulance.longitude)
      ? [Number(ambulance.latitude), Number(ambulance.longitude)]
      : null;

  const hospitalPosition =
    hospital && isValidPosition(hospital.latitude, hospital.longitude)
      ? [Number(hospital.latitude), Number(hospital.longitude)]
      : null;

  if (!patientPosition && !ambulancePosition && !hospitalPosition) {
    return null;
  }

  const mapCenter =
    patientPosition || ambulancePosition || hospitalPosition;

  const hospitalRoadDistance = getRoadDistance(hospital);

  return (
    <div className="map-frame" style={{ height: "360px", width: "100%" }}>
      <MapContainer
        center={mapCenter}
        zoom={14}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FitMap
          patient={patient}
          hospital={hospital}
          ambulance={ambulance}
        />

        {patientPosition && (
          <Marker position={patientPosition} icon={patientIcon}>
            <Popup>🔴 Emergency patient location</Popup>
          </Marker>
        )}

        {ambulancePosition && (
          <Marker position={ambulancePosition} icon={ambulanceIcon}>
            <Popup>
              <strong>
                🚑 {ambulance.ambulanceNumber || "Assigned Ambulance"}
              </strong>
              <br />
              Driver: {ambulance.driverName || "Not available"}
              <br />
              Type: {ambulance.ambulanceType || "Not available"}
              <br />
              Status: {ambulance.status || "Not available"}
            </Popup>
          </Marker>
        )}

        {hospitalPosition && (
          <Marker position={hospitalPosition} icon={hospitalIcon}>
            <Popup>
              <strong>{hospital.name}</strong>
              <br />
              {hospital.address}
              <br />
              {hospitalRoadDistance != null &&
                `${hospitalRoadDistance.toFixed(1)} km by road`}
            </Popup>
          </Marker>
        )}

        {patientPosition && hospitalPosition && routeCoordinates.length > 1 && (
          <Polyline
            positions={routeCoordinates}
            pathOptions={{
              color: "#2583ff",
              weight: 5,
              opacity: 0.9,
            }}
          />
        )}

        {patientPosition &&
          hospitalPosition &&
          routeCoordinates.length < 2 && (
            <Polyline
              positions={[patientPosition, hospitalPosition]}
              pathOptions={{
                color: "#2583ff",
                weight: 4,
                opacity: 0.8,
                dashArray: "8 8",
              }}
            />
          )}
      </MapContainer>
    </div>
  );
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [locationNotice, setLocationNotice] = useState("");
  const [locationError, setLocationError] = useState("");

  const [request, setRequest] = useState(null);
  const [assignedAmbulance, setAssignedAmbulance] = useState(null);
  const [trackingId, setTrackingId] = useState("");
  const [location, setLocation] = useState("");
  const [gps, setGps] = useState(null);

  const [nearbyHospitals, setNearbyHospitals] = useState([]);
  const [selectedHospital, setSelectedHospital] = useState(null);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [routeDistanceKm, setRouteDistanceKm] = useState(null);
  const [hospitalLoading, setHospitalLoading] = useState(false);
  const [selectingHospitalId, setSelectingHospitalId] = useState("");
  const [hospitalMessage, setHospitalMessage] = useState("");
  const [routeMessage, setRouteMessage] = useState("");

  const [confirmingHospital, setConfirmingHospital] = useState(false);
  const [hospitalConfirmed, setHospitalConfirmed] = useState(false);
  const [assigningAmbulance, setAssigningAmbulance] = useState(false);
  const [assignmentMessage, setAssignmentMessage] = useState("");

  const [dispatchDistance, setDispatchDistance] = useState(null);
  const [dispatchETA, setDispatchETA] = useState(null);

  const [showSuccessPopup, setShowSuccessPopup] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  const selectedRoadDistance =
    getRoadDistance(selectedHospital) ?? routeDistanceKm;

  // Refresh assigned ambulance details every 4 seconds.
  useEffect(() => {
    if (!request?.id) return;

    let isMounted = true;

    const refreshAmbulance = async () => {
      try {
        const response = await fetch(
          `${API}/emergency/${encodeURIComponent(request.id)}`,
          { cache: "no-store" }
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok || !isMounted) return;

        setRequest((previous) =>
          previous
            ? {
                ...previous,
                status: data.status || previous.status,
              }
            : previous
        );

        const ambulanceData = normalizeAmbulance(data);

        if (ambulanceData) {
          setAssignedAmbulance(ambulanceData);

          setDispatchDistance(
            ambulanceData.distanceKm != null
              ? Number(ambulanceData.distanceKm)
              : null
          );

          setDispatchETA(
            ambulanceData.estimatedDurationMinutes != null
              ? Number(ambulanceData.estimatedDurationMinutes)
              : null
          );
        } else {
          setAssignedAmbulance(null);
          setDispatchDistance(null);
          setDispatchETA(null);
        }
      } catch (err) {
        console.error("Ambulance location refresh failed:", err);
      }
    };

    refreshAmbulance();

    const intervalId = setInterval(refreshAmbulance, 4000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [request?.id]);

  const openEmergencyForm = () => {
    closeMenu();
    setError("");
    setNotice("");
    setLocationError("");
    setLocationNotice("");
    setLocation("");
    setGps(null);
    setShowForm(true);
  };

  const getCurrentLocation = () => {
    setLocationError("");
    setLocationNotice("");

    if (!navigator.geolocation) {
      setLocationError("GPS is not supported by this browser.");
      return;
    }

    setLocationNotice("Getting your current location...");

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const { latitude, longitude } = coords;

        setGps({ latitude, longitude });
        setLocation(`${latitude}, ${longitude}`);

        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`
          );

          if (response.ok) {
            const data = await response.json();

            if (data.display_name) {
              setLocation(data.display_name);
            }
          }
        } catch {
          // Keep GPS coordinates if address lookup fails.
        }

        setLocationNotice("Location captured. Please verify the map pin.");
      },
      () => {
        setLocationError(
          "Location unavailable. Allow location permission or enter the address manually."
        );
        setLocationNotice("");
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  const recoverTrackingGps = () => {
    setHospitalMessage("");

    if (!navigator.geolocation) {
      setHospitalMessage("GPS is not supported by this browser. Open this request on a device with location support.");
      return;
    }

    setHospitalLoading(true);
    setHospitalMessage("Getting this device's GPS location. Use this only if the device is at the patient's location.");

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const recoveredGps = {
          latitude: Number(coords.latitude),
          longitude: Number(coords.longitude),
        };

        if (!isValidPosition(recoveredGps.latitude, recoveredGps.longitude)) {
          setHospitalMessage("The device returned invalid GPS coordinates. Please try again.");
          setHospitalLoading(false);
          return;
        }

        setGps(recoveredGps);
        setHospitalMessage("Patient location recovered from this device's GPS. You can now retry ambulance dispatch.");

        if (selectedHospital) {
          await updateHospitalRoute(recoveredGps, selectedHospital);
        } else if (request?.emergency) {
          await findNearbyHospital(recoveredGps, request.emergency);
        }

        setHospitalLoading(false);
      },
      (geoError) => {
        const message =
          geoError.code === 1
            ? "Location permission was denied. Allow location access in your browser and try again."
            : geoError.code === 3
              ? "GPS request timed out. Please try again."
              : "Could not retrieve GPS location. Check your device location settings.";

        setHospitalMessage(message);
        setHospitalLoading(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  const geocodeAddress = async (address) => {
    if (!address) return null;

    const coordinateMatch = address.match(
      /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/
    );

    if (coordinateMatch) {
      const latitude = Number(coordinateMatch[1]);
      const longitude = Number(coordinateMatch[2]);

      if (isValidPosition(latitude, longitude)) {
        return { latitude, longitude };
      }
    }

    try {
      const params = new URLSearchParams({
        format: "jsonv2",
        q: address,
        limit: "1",
      });

      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?${params}`
      );

      if (!response.ok) return null;

      const results = await response.json();

      if (!results.length) return null;

      const latitude = Number(results[0].lat);
      const longitude = Number(results[0].lon);

      if (!isValidPosition(latitude, longitude)) return null;

      return { latitude, longitude };
    } catch (err) {
      console.error("Address geocoding failed:", err);
      return null;
    }
  };

  const updateHospitalRoute = async (patientGps, hospital) => {
    setRouteCoordinates([]);
    setRouteDistanceKm(null);
    setRouteMessage("");

    if (!patientGps || !hospital) {
      setRouteMessage(
        "Patient or hospital location is unavailable, so the road route cannot be shown."
      );
      return;
    }

    const latitude = Number(patientGps.latitude);
    const longitude = Number(patientGps.longitude);
    const hospitalLatitude = Number(hospital.latitude);
    const hospitalLongitude = Number(hospital.longitude);

    if (
      !isValidPosition(latitude, longitude) ||
      !isValidPosition(hospitalLatitude, hospitalLongitude)
    ) {
      setRouteMessage("Valid coordinates are not available for routing.");
      return;
    }

    try {
      const routeResponse = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${longitude},${latitude};${hospitalLongitude},${hospitalLatitude}?overview=full&geometries=geojson`
      );

      const routeData = await routeResponse.json();

      if (
        routeResponse.ok &&
        routeData.code === "Ok" &&
        routeData.routes?.[0]?.geometry?.coordinates
      ) {
        const coordinates = routeData.routes[0].geometry.coordinates.map(
          ([lon, lat]) => [lat, lon]
        );

        setRouteCoordinates(coordinates);
        setRouteDistanceKm(
          Number((routeData.routes[0].distance / 1000).toFixed(1))
        );
        setRouteMessage(`Road route to ${hospital.name} is shown on the map.`);
      } else {
        setRouteMessage(
          "Road routing is unavailable right now. The dashed line is a direct connection, not a road."
        );
      }
    } catch {
      setRouteMessage(
        "The routing service could not be reached. The dashed line is a direct connection, not a road."
      );
    }
  };

  const findNearbyHospital = async (patientGps, emergencyType) => {
    setNearbyHospitals([]);
    setSelectedHospital(null);
    setRouteCoordinates([]);
    setRouteDistanceKm(null);
    setRouteMessage("");
    setHospitalMessage("");
    setHospitalConfirmed(false);
    setShowSuccessPopup(false);

    if (
      !patientGps ||
      !isValidPosition(patientGps.latitude, patientGps.longitude)
    ) {
      setHospitalMessage(
        "Patient GPS coordinates could not be found. Please check the saved address or use GPS when submitting a new request."
      );
      return;
    }

    setHospitalLoading(true);

    try {
      const category = getHospitalCategory(emergencyType);

      const params = new URLSearchParams({
        latitude: String(patientGps.latitude),
        longitude: String(patientGps.longitude),
        radiusKm: "25",
      });

      if (category) {
        params.set("emergencyType", category);
      }

      const response = await fetch(
        `${API}/hospitals/nearby?${params}`,
        { cache: "no-store" }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message || "Could not search nearby hospitals."
        );
      }

      const hospitals = (data.hospitals || []).filter(
        (hospital) =>
          hospital.id != null &&
          isValidPosition(hospital.latitude, hospital.longitude)
      );

      setNearbyHospitals(hospitals);

      if (hospitals.length === 0) {
        setHospitalMessage(
          "No verified hospital was found within 25 km."
        );
        return;
      }

      const recommended = hospitals[0];

      setSelectedHospital(recommended);

      setHospitalMessage(
        `${recommended.name} is the recommended hospital. You can select another one below.`
      );

      updateHospitalRoute(patientGps, recommended);
    } catch (err) {
      setHospitalMessage(
        err.message?.includes("fetch")
          ? "Could not connect to the backend. Make sure the Node.js server is running."
          : err.message || "Unable to find a nearby hospital."
      );
    } finally {
      setHospitalLoading(false);
    }
  };

  const selectHospital = async (hospital) => {
    if (!hospital) return;

    if (
      getHospitalKey(hospital) === getHospitalKey(selectedHospital)
    ) {
      return;
    }

    setSelectedHospital(hospital);
    setHospitalConfirmed(false);
    setShowSuccessPopup(false);
    setNotice("");
    setError("");
    setSelectingHospitalId(getHospitalKey(hospital));

    setHospitalMessage(
      `${hospital.name} selected. Updating the route...`
    );

    await updateHospitalRoute(gps, hospital);

    setHospitalMessage(
      `${hospital.name} is selected. Click "Confirm Hospital" to save this choice.`
    );

    setSelectingHospitalId("");
  };

  const assignAvailableAmbulance = async () => {
    if (!request?.id) {
      setAssignmentMessage("No active emergency request was found.");
      return;
    }

    if (!gps || !isValidPosition(gps.latitude, gps.longitude)) {
      setAssignmentMessage(
        "Patient GPS coordinates are unavailable. Capture or recover a valid location before dispatch."
      );
      return;
    }

    if (assignedAmbulance) {
      setAssignmentMessage(
        "An ambulance is already assigned to this emergency."
      );
      return;
    }

    setAssigningAmbulance(true);
    setAssignmentMessage("Finding the fastest available ambulance by road route...");

    try {
      const assignResponse = await fetch(
        `${API}/emergency/${encodeURIComponent(request.id)}/ambulance`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            latitude: Number(gps.latitude),
            longitude: Number(gps.longitude),
          }),
        }
      );

      const assignData = await assignResponse.json().catch(() => ({}));

      if (!assignResponse.ok) {
        throw new Error(
          assignData.message || "Smart ambulance dispatch failed."
        );
      }

      const normalized = normalizeAmbulance(assignData);

      if (!normalized) {
        throw new Error(
          "Dispatch response received, but ambulance details were missing. Refresh the request to retrieve the saved assignment."
        );
      }

      setAssignedAmbulance(normalized);

      setDispatchDistance(
        normalized.distanceKm != null
          ? Number(normalized.distanceKm)
          : null
      );

      setDispatchETA(
        normalized.estimatedDurationMinutes != null
          ? Number(normalized.estimatedDurationMinutes)
          : null
      );

      setRequest((previous) =>
        previous
          ? { ...previous, status: "Ambulance Assigned" }
          : previous
      );

      setAssignmentMessage(
        `Ambulance ${normalized.ambulanceNumber} assigned successfully.`
      );
    } catch (err) {
      setAssignmentMessage(
        err.message || "Could not dispatch an ambulance."
      );
    } finally {
      setAssigningAmbulance(false);
    }
  };

  const submitHospitalResponse = async () => {
    if (confirmingHospital || hospitalConfirmed) return;

    if (!request?.id) {
      setError("No active emergency request was found.");
      return;
    }

    if (!selectedHospital?.id) {
      setError("Please select a valid hospital first.");
      return;
    }

    setConfirmingHospital(true);
    setError("");
    setNotice("");
    setShowSuccessPopup(false);

    try {
      const response = await fetch(
        `${API}/emergency/${encodeURIComponent(request.id)}/hospital`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            hospitalId: selectedHospital.id,
          }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message || "Could not confirm the selected hospital."
        );
      }

      setHospitalConfirmed(true);

      setHospitalMessage(
        `Hospital confirmed: ${data.hospital?.name || selectedHospital.name}.`
      );

      setShowSuccessPopup(true);

      await assignAvailableAmbulance();
    } catch (err) {
      setHospitalConfirmed(false);
      setError(
        err.message?.includes("fetch")
          ? "Cannot connect to the backend. Check that the server is running."
          : err.message || "Hospital confirmation failed. Please try again."
      );
    } finally {
      setConfirmingHospital(false);
    }
  };

  const submitEmergency = async (event) => {
    event.preventDefault();

    if (loading) return;

    const formData = new FormData(event.currentTarget);

    const payload = {
      patientName: String(formData.get("patientName") || "").trim(),
      contactNumber: String(formData.get("contactNumber") || "").trim(),
      emergencyType: String(formData.get("emergencyType") || ""),
      patientCondition: String(formData.get("patientCondition") || "Unknown"),
      location: String(formData.get("location") || "").trim(),
    };

    if (
      !payload.patientName ||
      !payload.contactNumber ||
      !payload.emergencyType ||
      !payload.location
    ) {
      setError("Please fill in all required fields.");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");
    setShowConfirmation(false);
    setHospitalConfirmed(false);
    setShowSuccessPopup(false);
    setAssignedAmbulance(null);
    setAssignmentMessage("");
    setDispatchDistance(null);
    setDispatchETA(null);

    try {
      let patientGps = gps;

      if (
        !patientGps ||
        !isValidPosition(patientGps.latitude, patientGps.longitude)
      ) {
        patientGps = await geocodeAddress(payload.location);
      }

      if (patientGps) {
        setGps(patientGps);
      }

      const response = await fetch(`${API}/emergency`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "Could not submit the request.");
      }

      const savedRequest = {
        id: data.requestId || data.request_id,
        patient: data.patientName || payload.patientName,
        contact: payload.contactNumber,
        emergency: data.emergencyType || payload.emergencyType,
        condition: data.patientCondition || payload.patientCondition,
        location: payload.location,
        priorityLevel:
          data.priorityLevel || data.priority_level || "Pending",
        triageSummary: data.triageSummary || data.triage_summary || "",
        status: data.status || "Received",
      };

      // PERSISTENCE FIX: Save the newly created request ID.
      if (savedRequest.id) {
        try {
          localStorage.setItem(STORAGE_KEY, savedRequest.id);
        } catch (storageError) {
          console.error("Could not save emergency ID:", storageError);
        }
      }

      setRequest(savedRequest);
      setTrackingId(savedRequest.id || "");
      setShowConfirmation(true);
      setShowForm(false);
      setNotice("");
      setError("");

      await findNearbyHospital(patientGps, savedRequest.emergency);

      setTimeout(() => {
        document.getElementById("request-tracking")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
    } catch (err) {
      setError(
        err.message?.includes("fetch")
          ? "Cannot connect to the backend. Start your Node.js server on port 5000."
          : err.message || "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  };

  const trackRequest = async (event, savedId = "") => {
    event?.preventDefault();

    const id = (savedId || trackingId).trim();

    if (!id) {
      setError("Enter your emergency Request ID.");
      return;
    }

    setTracking(true);
    setError("");
    setNotice("");
    setHospitalMessage("");
    setRouteMessage("");
    setRouteDistanceKm(null);
    setAssignmentMessage("");
    setDispatchDistance(null);
    setDispatchETA(null);
    setShowConfirmation(false);
    setHospitalConfirmed(false);
    setShowSuccessPopup(false);

    setAssignedAmbulance(null);

    try {
      const response = await fetch(
        `${API}/emergency/${encodeURIComponent(id)}`,
        { cache: "no-store" }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message || "Request not found. Check the ID and try again."
        );
      }

      const trackedRequest = {
        id: data.request_id || data.requestId || id,
        patient: data.patient_name || data.patientName || "Not available",
        contact: data.contact_number || data.contactNumber || "",
        emergency: data.emergency_type || data.emergencyType || "Not available",
        condition: data.patient_condition || data.patientCondition || "Unknown",
        location: data.location || "Not available",
        priorityLevel: data.priority_level || data.priorityLevel || "Pending",
        triageSummary: data.triage_summary || data.triageSummary || "",
        status: data.status || "Request recorded",
      };

      // PERSISTENCE FIX: Save the ID when a user manually tracks a request too.
      try {
        localStorage.setItem(STORAGE_KEY, trackedRequest.id);
      } catch (storageError) {
        console.error("Could not save emergency ID:", storageError);
      }

      setTrackingId(trackedRequest.id);
      setRequest(trackedRequest);
      setNotice("Request details retrieved.");

      setGps(null);
      setNearbyHospitals([]);
      setRouteCoordinates([]);
      setSelectedHospital(null);

      const ambulanceData = normalizeAmbulance(data);

      if (ambulanceData) {
        setAssignedAmbulance(ambulanceData);

        setDispatchDistance(
          ambulanceData.distanceKm != null
            ? Number(ambulanceData.distanceKm)
            : null
        );

        setDispatchETA(
          ambulanceData.estimatedDurationMinutes != null
            ? Number(ambulanceData.estimatedDurationMinutes)
            : null
        );

        setAssignmentMessage(
          `Assigned ambulance retrieved: ${ambulanceData.ambulanceNumber}`
        );
      } else {
        setAssignedAmbulance(null);
        setDispatchDistance(null);
        setDispatchETA(null);
      }

      let savedHospitalFound = false;

      if (data.selected_hospital_id != null) {
        setHospitalConfirmed(true);

        try {
          const hospitalsResponse = await fetch(
            `${API}/hospitals`,
            { cache: "no-store" }
          );

          const hospitalsData = await hospitalsResponse.json().catch(() => ({}));

          const matchedHospital = (hospitalsData.hospitals || []).find(
            (hospital) =>
              String(hospital.id) === String(data.selected_hospital_id)
          );

          if (matchedHospital) {
            setSelectedHospital(matchedHospital);
            savedHospitalFound = true;
            setHospitalMessage(
              `Previously confirmed hospital: ${matchedHospital.name}`
            );
          } else {
            setHospitalMessage(
              `Previously confirmed hospital: ${data.selected_hospital_name || "Hospital"}. Its map coordinates are unavailable.`
            );
          }
        } catch {
          setHospitalMessage(
            `Previously confirmed hospital: ${data.selected_hospital_name || "Hospital"}. Hospital map details could not be loaded.`
          );
        }
      } else {
        setHospitalConfirmed(false);
      }

      setHospitalLoading(true);
      setHospitalMessage("Recovering the patient's saved location...");

      const savedGps =
        isValidPosition(data.patient_latitude, data.patient_longitude)
          ? {
              latitude: Number(data.patient_latitude),
              longitude: Number(data.patient_longitude),
            }
          : null;

      const recoveredGps =
        savedGps || await geocodeAddress(trackedRequest.location);

      if (recoveredGps) {
        setGps(recoveredGps);

        if (savedHospitalFound) {
          const hospitalsResponse = await fetch(
            `${API}/hospitals`,
            { cache: "no-store" }
          );

          const hospitalsData = await hospitalsResponse.json().catch(() => ({}));

          const matchedHospital = (hospitalsData.hospitals || []).find(
            (hospital) =>
              String(hospital.id) === String(data.selected_hospital_id)
          );

          if (matchedHospital) {
            setSelectedHospital(matchedHospital);
            updateHospitalRoute(recoveredGps, matchedHospital);
          }
        } else {
          await findNearbyHospital(recoveredGps, trackedRequest.emergency);
        }
      } else {
        setHospitalMessage(
          "GPS coordinates are missing and the saved address could not be located. If this device is physically at the patient's location, use the GPS recovery button below."
        );
      }

      setHospitalLoading(false);
    } catch (err) {
      setError(
        err.message?.includes("fetch")
          ? "Cannot connect to the backend. Check whether the server is running."
          : err.message || "Unable to track this request."
      );
    } finally {
      setHospitalLoading(false);
      setTracking(false);
    }
  };

  // PERSISTENCE FIX: Automatically restore the last request on page load.
  useEffect(() => {
    let savedId = "";

    try {
      savedId = localStorage.getItem(STORAGE_KEY) || "";
    } catch (storageError) {
      console.error("Could not read saved emergency ID:", storageError);
    }

    if (savedId.trim()) {
      setTrackingId(savedId.trim());

      // Reuse the existing tracking function to fetch all details from the API.
      trackRequest({ preventDefault: () => {} }, savedId.trim());
    }
    // Run only once when the application first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app" id="home">
      <header className="navbar">
        <div className="container navbar-inner">
          <a className="logo" href="#home" onClick={closeMenu}>
            <span className="logo-icon">✚</span>
            Medi<span>Route</span>
          </a>

          <button
            className="menu-toggle"
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
          >
            {menuOpen ? "✕" : "☰"}
          </button>

          <nav className={`nav-links ${menuOpen ? "open" : ""}`}>
            <a href="#home" onClick={closeMenu}>Home</a>
            <a href="#why-medi-route" onClick={closeMenu}>About</a>
            <a href="#features" onClick={closeMenu}>Features</a>
            <a href="#how-it-works" onClick={closeMenu}>How It Works</a>
            <a href="#request-tracking" onClick={closeMenu}>Track Request</a>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero">
          <EcgLine />

          <div className="container hero-inner">
            <div className="hero-content">
              <div className="eyebrow">EMERGENCY RESPONSE, CONNECTED</div>

              <div className="hero-headline-wrap">
                <h1 className="hero-title">
                  <span className="headline-line">Every Second</span>
                  <span className="headline-line headline-middle">of Your Life</span>
                  <span className="headline-line headline-accent">Counts.</span>
                </h1>
              </div>

              <p className="hero-description">
                A connected emergency coordination platform designed to
                organize requests, share location information and support
                hospital coordination.
              </p>

              <div className="hero-buttons">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={openEmergencyForm}
                >
                  Request an Ambulance <span>→</span>
                </button>

                <a className="btn btn-secondary" href="#how-it-works">
                  How It Works
                </a>
              </div>

              <p className="hero-note">
                <span className="status-dot" />
                Designed for clearer emergency coordination
              </p>
            </div>

            <div className="hero-visual">
              <div className="hero-status">
                <span className="status-dot" />
                MEDIROUTE RESPONSE SYSTEM
              </div>

              <div className="hero-cross">✚</div>
              <div className="hero-ambulance">🚑</div>

              <h3>Every Second Matters</h3>
              <p>Emergency requests · Location · Coordination</p>

              <div className="hero-stat-row">
                <div><strong>01</strong><span>Request</span></div>
                <div><strong>02</strong><span>Coordinate</span></div>
                <div><strong>03</strong><span>Connect</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="mission-strip container">
          <div>✚ <strong>Emergency Requests</strong></div>
          <div>↗ <strong>Ambulance Coordination</strong></div>
          <div>⌖ <strong>Hospital Connectivity</strong></div>
        </section>

        <section className="section" id="why-medi-route">
          <div className="container">
            <div className="section-heading">
              <div className="eyebrow">WHY MEDIROUTE?</div>
              <h2>When Every Second Matters,<br />Clarity Matters Too.</h2>
              <p>Keep essential emergency information together in one accessible interface.</p>
            </div>

            <div className="features-grid">
              {[
                ["⚡", "Simpler Requests", "Enter the essential details in one place."],
                ["🏥", "Connected Care", "Bring hospital information into the response workflow."],
                ["📍", "Location Aware", "Use GPS coordinates to communicate an emergency location."],
                ["✓", "Clear Confirmation", "Receive a request ID to identify a saved request."],
              ].map(([icon, title, text]) => (
                <article className="feature-card" key={title}>
                  <div className="feature-icon">{icon}</div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="features">
          <div className="container">
            <div className="section-heading">
              <div className="eyebrow">CORE CAPABILITIES</div>
              <h2>One Platform.<br />Eight Connected Features.</h2>
              <p>Explore the planned emergency coordination capabilities.</p>
            </div>

            <div className="features-grid">
              {features.map((feature, index) => (
                <article className="feature-card" key={feature.title}>
                  <div className="feature-topline">
                    FEATURE {String(index + 1).padStart(2, "0")}
                  </div>
                  <div className="feature-icon">{feature.icon}</div>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="how-it-works">
          <div className="container">
            <div className="section-heading">
              <div className="eyebrow">SIMPLE WORKFLOW</div>
              <h2>From Emergency to Coordination</h2>
            </div>

            <div className="journey-grid">
              {[
                ["01", "Submit Request", "Provide contact, emergency and location details."],
                ["02", "Review Priority", "The backend evaluates the emergency using its triage rules."],
                ["03", "Track the Request", "Use the request ID to retrieve the saved details."],
              ].map(([number, title, text]) => (
                <article className="journey-step" key={number}>
                  <span className="step-number">{number}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="request-tracking">
          <div className="container">
            <div className="section-heading">
              <div className="eyebrow">
                {showConfirmation ? "REQUEST CONFIRMATION" : "REQUEST STATUS"}
              </div>

              <h2>
                {showConfirmation
                  ? "Emergency Request Confirmed"
                  : "Track Your Emergency Request"}
              </h2>

              <p>
                {showConfirmation
                  ? "Your request has been recorded. Choose a hospital and confirm it to dispatch an ambulance."
                  : "Enter the Request ID received after submitting a request."}
              </p>
            </div>

            {!showConfirmation && (
              <form className="tracking-form" onSubmit={trackRequest}>
                <label htmlFor="trackingId">Emergency Request ID</label>
                <input
                  id="trackingId"
                  value={trackingId}
                  onChange={(event) => setTrackingId(event.target.value)}
                  placeholder="Example: MR-978109"
                  required
                />
                <button className="btn btn-primary" type="submit" disabled={tracking}>
                  {tracking ? "Checking..." : "Track Request →"}
                </button>
              </form>
            )}

            {tracking && (
              <p className="notice-message" role="status">
                Restoring your saved emergency request...
              </p>
            )}

            {notice && (
              <p className="notice-message" role="status">{notice}</p>
            )}

            {error && <p className="error-message" role="alert">{error}</p>}

            {request && (
              <article className="request-card">
                {request.status === "Arrived" && (
                  <div className="arrived-banner" role="status">
                    <div className="arrived-banner-icon" aria-hidden="true">✓</div>
                    <div>
                      <h3>Ambulance has arrived at the hospital</h3>
                      <p>
                        {selectedHospital?.name
                          ? `The patient has reached ${selectedHospital.name}.`
                          : "The patient has reached the selected hospital."}
                      </p>
                    </div>
                  </div>
                )}

                {showConfirmation && (
                  <div
                    role="status"
                    style={{
                      padding: "20px",
                      marginBottom: "24px",
                      border: "1px solid rgba(214,40,57,0.45)",
                      borderRadius: "14px",
                      background: "rgba(214,40,57,0.07)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
                      <span style={{ fontSize: "30px", color: "#c81e2f" }}>✓</span>
                      <div>
                        <h3 style={{ margin: 0, color: "#c81e2f" }}>
                          Request Submitted Successfully!
                        </h3>
                        <p style={{ margin: "6px 0 0" }}>
                          Your emergency request has been recorded.
                        </p>
                      </div>
                    </div>
                    <p style={{ margin: "8px 0" }}>Your Request ID is:</p>
                    <strong style={{ display: "inline-block", fontSize: "20px", letterSpacing: "1px", overflowWrap: "anywhere" }}>
                      {request.id || "Request ID unavailable"}
                    </strong>
                    <p style={{ marginBottom: 0, fontSize: "14px" }}>
                      Save this ID so you can retrieve your request later.
                    </p>
                  </div>
                )}

                {hospitalConfirmed && (
                  <div
                    role="status"
                    style={{
                      padding: "18px",
                      marginBottom: "24px",
                      border: "1px solid rgba(214,40,57,0.5)",
                      borderRadius: "14px",
                      background: "rgba(214,40,57,0.08)",
                    }}
                  >
                    <h3 style={{ color: "#c81e2f", marginTop: 0 }}>
                      ✓ Hospital Selection Confirmed
                    </h3>
                    <p style={{ marginBottom: 0 }}>
                      {selectedHospital?.name
                        ? `${selectedHospital.name} is saved for this request.`
                        : hospitalMessage || "A hospital selection is saved for this request."}
                    </p>
                  </div>
                )}

                <div className="request-card-header">
                  <div>
                    <span className="eyebrow">
                      {hospitalConfirmed
                        ? "HOSPITAL CONFIRMED"
                        : showConfirmation
                          ? "REQUEST RECORDED — HOSPITAL PENDING"
                          : "SAVED REQUEST"}
                    </span>
                    <h3>{request.id || "Request recorded"}</h3>
                  </div>
                  <span className="priority-pill">{request.priorityLevel}</span>
                </div>

                <div className="request-details">
                  <p><span>Patient Name</span><strong>{request.patient || "Not available"}</strong></p>
                  <p><span>Contact Number</span><strong>{request.contact || "Not available"}</strong></p>
                  <p><span>Emergency Type</span><strong>{request.emergency || "Not available"}</strong></p>
                  <p><span>Patient Condition</span><strong>{request.condition || "Unknown"}</strong></p>
                  <p><span>Emergency Location</span><strong>{request.location || "Not available"}</strong></p>
                  <p><span>Request Status</span><strong>{request.status || "Recorded"}</strong></p>
                </div>

                {request.triageSummary && (
                  <div style={{ marginTop: "18px" }}>
                    <h3>Emergency Priority Summary</h3>
                    <p className="triage-summary">{request.triageSummary}</p>
                  </div>
                )}

                {assignedAmbulance && (
                  <div
                    style={{
                      marginTop: "22px",
                      padding: "18px",
                      border: "1px solid rgba(59,130,246,0.45)",
                      borderRadius: "14px",
                      background: "rgba(59,130,246,0.07)",
                    }}
                  >
                    <h3 style={{ marginTop: 0 }}>🚑 Assigned Ambulance</h3>

                    <div className="request-details">
                      <p>
                        <span>Ambulance Number</span>
                        <strong>{assignedAmbulance.ambulanceNumber}</strong>
                      </p>
                      <p>
                        <span>Driver Name</span>
                        <strong>{assignedAmbulance.driverName}</strong>
                      </p>
                      <p>
                        <span>Driver Phone</span>
                        <strong>{assignedAmbulance.driverPhone}</strong>
                      </p>
                      <p>
                        <span>Ambulance Type</span>
                        <strong>{assignedAmbulance.ambulanceType}</strong>
                      </p>
                      <p>
                        <span>Ambulance Status</span>
                        <strong>{assignedAmbulance.status}</strong>
                      </p>

                      {dispatchDistance != null && (
                        <p>
                          <span>Distance to Patient (by road)</span>
                          <strong>{dispatchDistance.toFixed(2)} km</strong>
                        </p>
                      )}

                      {dispatchETA != null && (
                        <p>
                          <span>Estimated Arrival Time</span>
                          <strong>{dispatchETA.toFixed(1)} minutes</strong>
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {assignmentMessage && (
                  <p className="notice-message" role="status">
                    {assigningAmbulance ? "🚑 " : ""}
                    {assignmentMessage}
                  </p>
                )}

                <div style={{ marginTop: "28px" }}>
                  <h3>Patient, Ambulance & Hospital Map</h3>

                  {hospitalLoading && (
                    <p className="notice-message" role="status">
                      Finding patient location and nearby verified hospitals...
                    </p>
                  )}

                  {hospitalMessage && (
                    <p className="notice-message" role="status">{hospitalMessage}</p>
                  )}

                  {(gps || assignedAmbulance || selectedHospital) && (
                    <MapView
                      patient={gps}
                      ambulance={assignedAmbulance}
                      hospital={selectedHospital}
                      routeCoordinates={routeCoordinates}
                    />
                  )}

                  {!assignedAmbulance && (
                    <p className="notice-message">
                      No ambulance has been assigned to this request yet.
                    </p>
                  )}

                  {!gps && (
                    <p className="error-message">
                      Patient GPS coordinates are not available. The saved address may not be specific enough to locate the patient on the map.
                    </p>
                  )}

                  {selectedHospital && (
                    <div className="request-details" style={{ marginTop: "18px" }}>
                      <p>
                        <span>Selected Hospital</span>
                        <strong>
                          {selectedHospital.name}
                          {nearbyHospitals.length > 0 &&
                            getHospitalKey(selectedHospital) === getHospitalKey(nearbyHospitals[0]) &&
                            " (Recommended)"}
                        </strong>
                      </p>
                      <p><span>Hospital Address</span><strong>{selectedHospital.address || "Not provided"}</strong></p>
                      <p>
                        <span>Distance by Road</span>
                        <strong>
                          {selectedRoadDistance != null
                            ? `${Number(selectedRoadDistance).toFixed(1)} km`
                            : "Not available"}
                        </strong>
                      </p>
                      <p><span>Hospital Phone</span><strong>{selectedHospital.phone || "Not provided"}</strong></p>
                    </div>
                  )}

                  {!hospitalConfirmed && gps && nearbyHospitals.length > 0 && (
                    <div style={{ marginTop: "28px" }}>
                      <h3>Choose a Hospital</h3>
                      <p className="form-disclaimer">
                        The first hospital is recommended by the system. Select
                        your preferred hospital, then confirm your choice.
                      </p>

                      <div style={{ display: "grid", gap: "14px", marginTop: "16px" }}>
                        {nearbyHospitals.map((hospital, index) => {
                          const isRecommended = index === 0;
                          const isSelected =
                            getHospitalKey(hospital) === getHospitalKey(selectedHospital);
                          const roadDistance = getRoadDistance(hospital);

                          return (
                            <article
                              key={getHospitalKey(hospital)}
                              style={{
                                padding: "18px",
                                borderRadius: "14px",
                                border: isSelected
                                  ? "1px solid #d62839"
                                  : "1px solid rgba(170,70,80,0.25)",
                                background: isSelected
                                  ? "rgba(214,40,57,0.07)"
                                  : "rgba(170,70,80,0.03)",
                              }}
                            >
                              <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
                                <div style={{ flex: "1 1 220px" }}>
                                  <h4 style={{ margin: "0 0 8px" }}>
                                    🏥 {hospital.name}
                                  </h4>

                                  {isRecommended && (
                                    <span
                                      style={{
                                        display: "inline-block",
                                        padding: "5px 9px",
                                        marginBottom: "8px",
                                        borderRadius: "20px",
                                        color: "#c81e2f",
                                        background: "rgba(214,40,57,0.1)",
                                        border: "1px solid rgba(214,40,57,0.35)",
                                        fontSize: "12px",
                                        fontWeight: 700,
                                      }}
                                    >
                                      ★ Recommended
                                    </span>
                                  )}

                                  <p style={{ margin: "4px 0", fontSize: "14px" }}>
                                    {hospital.address || "Address not provided"}
                                  </p>
                                  <p style={{ margin: "4px 0", fontSize: "14px" }}>
                                    Distance by road: {roadDistance != null
                                      ? `${roadDistance.toFixed(1)} km`
                                      : "Not available"}
                                  </p>
                                  <p style={{ margin: "4px 0", fontSize: "14px" }}>
                                    Phone: {hospital.phone || "Not provided"}
                                  </p>
                                </div>

                                <button
                                  type="button"
                                  className={isSelected ? "btn btn-secondary" : "btn btn-primary"}
                                  disabled={isSelected || Boolean(selectingHospitalId)}
                                  onClick={() => selectHospital(hospital)}
                                >
                                  {isSelected
                                    ? "✓ Selected"
                                    : selectingHospitalId === getHospitalKey(hospital)
                                      ? "Updating Route..."
                                      : "Select Hospital"}
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {routeMessage && (
                    <p className="notice-message" role="status">{routeMessage}</p>
                  )}
                </div>

                {gps && nearbyHospitals.length > 0 && !hospitalConfirmed && (
                  <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "24px" }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={submitHospitalResponse}
                      disabled={
                        confirmingHospital ||
                        assigningAmbulance ||
                        hospitalLoading ||
                        !selectedHospital?.id
                      }
                    >
                      {confirmingHospital
                        ? "Confirming Hospital..."
                        : "Confirm Hospital & Smart Dispatch"}
                    </button>
                  </div>
                )}

                {hospitalConfirmed && !assignedAmbulance && !gps && (
                  <div style={{ marginTop: "24px" }}>
                    <p className="form-disclaimer">
                      This older request has no saved patient GPS coordinates.
                      Recover GPS only if this device is currently at the patient's location.
                    </p>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={recoverTrackingGps}
                      disabled={hospitalLoading}
                    >
                      {hospitalLoading ? "Recovering Location..." : "📍 Recover Patient Location Using GPS"}
                    </button>
                  </div>
                )}

                {hospitalConfirmed && !assignedAmbulance && gps && (
                  <div style={{ marginTop: "24px" }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={assignAvailableAmbulance}
                      disabled={assigningAmbulance}
                    >
                      {assigningAmbulance
                        ? "Finding Fastest Ambulance..."
                        : "🚑 Run Smart Ambulance Dispatch"}
                    </button>
                  </div>
                )}

                {showConfirmation && (
                  <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "24px" }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => window.print()}
                    >
                      Print Confirmation
                    </button>
                  </div>
                )}
              </article>
            )}
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <a className="logo" href="#home">Medi<span>Route</span></a>
          <p>Every second of your life counts. © {new Date().getFullYear()} MediRoute</p>
          <a href="#request-tracking">Track Request</a>
        </div>
      </footer>

      {showForm && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !loading) {
              setShowForm(false);
            }
          }}
        >
          <section
            className="emergency-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="emergency-title"
          >
            <div className="modal-header">
              <div>
                <div className="eyebrow">EMERGENCY INTAKE</div>
                <h2 id="emergency-title">Request Assistance</h2>
              </div>
              <button
                className="modal-close"
                type="button"
                disabled={loading}
                onClick={() => setShowForm(false)}
                aria-label="Close form"
              >
                ✕
              </button>
            </div>

            <p className="form-intro">
              Enter accurate details so the request can be recorded correctly.
            </p>

            <form className="emergency-form" onSubmit={submitEmergency}>
              <label htmlFor="patientName">Patient name *</label>
              <input
                id="patientName"
                name="patientName"
                autoComplete="name"
                required
                placeholder="Enter patient's full name"
              />

              <label htmlFor="contactNumber">Contact number *</label>
              <input
                id="contactNumber"
                name="contactNumber"
                type="tel"
                autoComplete="tel"
                required
                minLength={7}
                maxLength={20}
                placeholder="Enter a reachable phone number"
              />

              <label htmlFor="emergencyType">Emergency type *</label>
              <select id="emergencyType" name="emergencyType" required defaultValue="">
                <option value="" disabled>Select emergency type</option>
                {emergencyTypes.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>

              <label htmlFor="patientCondition">Patient condition</label>
              <select id="patientCondition" name="patientCondition" defaultValue="Unknown">
                {conditions.map((condition) => (
                  <option key={condition} value={condition}>{condition}</option>
                ))}
              </select>

              <label htmlFor="location">Emergency location *</label>
              <textarea
                id="location"
                name="location"
                value={location}
                onChange={(event) => {
                  setLocation(event.target.value);
                  setGps(null);
                }}
                required
                placeholder="Enter address, landmark or GPS coordinates"
                rows={3}
              />

              <button
                className="btn btn-secondary location-button"
                type="button"
                onClick={getCurrentLocation}
              >
                📍 Use Current Location
              </button>

              {locationNotice && (
                <p className="notice-message" role="status">{locationNotice}</p>
              )}

              {locationError && (
                <p className="error-message" role="alert">{locationError}</p>
              )}

              {gps && <MapView patient={gps} />}

              {error && <p className="error-message" role="alert">{error}</p>}

              <button
                className="btn btn-primary submit-button"
                type="submit"
                disabled={loading}
              >
                {loading ? "Submitting Request..." : "Submit Emergency Request →"}
              </button>

              <p className="form-disclaimer">
                Demo project: no real ambulance is dispatched.
              </p>
            </form>
          </section>
        </div>
      )}

      {showSuccessPopup && (
        <div
          className="success-popup-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowSuccessPopup(false);
            }
          }}
        >
          <section
            className="success-popup"
            role="dialog"
            aria-modal="true"
            aria-labelledby="success-popup-title"
          >
            <div className="success-popup-icon" aria-hidden="true">
              <svg
                width="42"
                height="42"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M7 10V5.5a1.5 1.5 0 0 1 3 0V10" />
                <path d="M10 10V4.5a1.5 1.5 0 0 1 3 0V10" />
                <path d="M13 10V6a1.5 1.5 0 0 1 3 0v5" />
                <path d="M7 10H5.5A2.5 2.5 0 0 0 3 12.5v1A7.5 7.5 0 0 0 10.5 21h2a6 6 0 0 0 5.5-3.6l2-4.6a1.5 1.5 0 0 0-2.7-1.3L16 14" />
                <path d="m16 3 1.2-1" />
              </svg>
            </div>

            <h2 id="success-popup-title">Request Confirmed!</h2>

            <p>Your hospital response has been saved.</p>

            <p className="success-popup-hospital">
              🏥 {selectedHospital?.name || "Selected hospital"}
            </p>

            <button
              type="button"
              className="success-popup-ok"
              onClick={() => setShowSuccessPopup(false)}
              autoFocus
            >
              OK
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;