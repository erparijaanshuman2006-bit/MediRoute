
import { useEffect, useState } from "react";
import {
    MapContainer,
    TileLayer,
    Marker,
    Popup
} from "react-leaflet";

import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix default Leaflet marker icons
delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
    iconRetinaUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
    iconUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
    shadowUrl:
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png"
});

const API_URL =
    import.meta.env.VITE_API_URL || "http://localhost:5000";

function AmbulanceMap({ requestId }) {

    // Initial demo position
    const [ambulancePosition, setAmbulancePosition] =
        useState([20.3000, 85.8300]);

    const [ambulance, setAmbulance] = useState(null);
    const [error, setError] = useState("");

    // Hospital location
    const hospitalPosition = [20.2961, 85.8245];

    useEffect(() => {

        if (!requestId) {
            setError("Emergency request ID is missing.");
            return;
        }

        let isMounted = true;

        async function fetchAmbulanceLocation() {
            try {
                const response = await fetch(
                    `${API_URL}/api/emergency/${encodeURIComponent(requestId)}`
                );

                if (!response.ok) {
                    throw new Error("Could not fetch ambulance location.");
                }

                const data = await response.json();

                if (!isMounted) return;

                if (
                    data.assigned_ambulance_id &&
                    Number.isFinite(Number(data.ambulance_latitude)) &&
                    Number.isFinite(Number(data.ambulance_longitude))
                ) {
                    setAmbulancePosition([
                        Number(data.ambulance_latitude),
                        Number(data.ambulance_longitude)
                    ]);

                    setAmbulance(data);
                    setError("");
                } else {
                    setError("No ambulance assigned yet.");
                }

            } catch (err) {
                if (isMounted) {
                    setError(err.message);
                }
            }
        }

        // Fetch immediately
        fetchAmbulanceLocation();

        // Refresh location every 4 seconds
        const interval = setInterval(
            fetchAmbulanceLocation,
            4000
        );

        return () => {
            isMounted = false;
            clearInterval(interval);
        };

    }, [requestId]);

    return (
        <div style={{ width: "100%" }}>

            <div style={{
                padding: "10px",
                marginBottom: "10px",
                background: "#f1f5f9",
                borderRadius: "8px"
            }}>
                <strong>
                    {ambulance
                        ? `Ambulance: ${ambulance.ambulance_number}`
                        : "Ambulance Tracking"}
                </strong>

                <p style={{ margin: "5px 0" }}>
                    {ambulance
                        ? `Driver: ${ambulance.driver_name}`
                        : "Waiting for ambulance details..."}
                </p>

                <small>
                    {error || "Refreshing location every 4 seconds"}
                </small>
            </div>

            <div style={{ height: "500px", width: "100%" }}>
                <MapContainer
                    center={ambulancePosition}
                    zoom={14}
                    style={{ height: "100%", width: "100%" }}
                >
                    <TileLayer
                        attribution='&copy; OpenStreetMap contributors'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    <Marker position={ambulancePosition}>
                        <Popup>
                            <strong>Ambulance</strong>
                            <br />
                            {ambulance?.ambulance_number || "Loading..."}
                            <br />
                            Driver: {ambulance?.driver_name || "Loading..."}
                            <br />
                            Status: {ambulance?.ambulance_status || "Unknown"}
                        </Popup>
                    </Marker>

                    <Marker position={hospitalPosition}>
                        <Popup>
                            Demo Hospital 1
                        </Popup>
                    </Marker>

                </MapContainer>
            </div>
        </div>
    );
}

export default AmbulanceMap;
