# 🚑 MediRoute – Smart Emergency Ambulance Dispatch System

MediRoute is a smart emergency ambulance dispatch system designed to simplify emergency response by connecting patients with nearby hospitals and available ambulances.

The system helps manage emergency requests, prioritize critical cases, select hospitals, and coordinate ambulance dispatch efficiently.

## ✨ Key Features

- **Emergency Registration:** Submit emergency requests with patient details and medical conditions.
- **Smart Triage:** Classifies emergencies based on priority and patient condition.
- **Hospital Selection:** View and select nearby hospitals.
- **Ambulance Dispatch:** Assign ambulances to emergency requests.
- **Live Map Visualization:** View patient, hospital, and ambulance locations.
- **Emergency Tracking:** Track emergency request and ambulance information.
- **Data Persistence:** Store emergency and ambulance information using PostgreSQL.
- **Multiple Emergency Requests:** Manage multiple emergency requests independently.

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| React.js | Frontend |
| JavaScript | Application logic |
| CSS | User interface styling |
| Node.js | Backend runtime |
| Express.js | Backend API |
| PostgreSQL | Database |
| Leaflet / React-Leaflet | Map visualization |
| Vite | Frontend development tool |

## 📁 Project Structure

```text
MediRoute/
│
├── backend/
│   ├── db.js
│   ├── server.js
│   ├── triage.js
│   ├── test-db.js
│   ├── package.json
│   └── .env
│
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── App.css
│   │   ├── AmbulanceMap.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── index.html
│
├── .gitignore
├── package.json
└── README.md
```

## ⚙️ Installation and Setup

### 1. Clone the Repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd MediRoute
```

### 2. Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file inside the backend folder and configure your PostgreSQL credentials:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=your_database_name
DB_USER=your_database_user
DB_PASSWORD=your_database_password
```

Start the backend:

```bash
node server.js
```

### 3. Frontend Setup

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the local URL displayed by Vite in your browser.

## 🗄️ Database

MediRoute uses PostgreSQL to manage application data, including:

- Emergency requests
- Patient information
- Hospital information
- Ambulance details
- Dispatch assignments

Configure your database before starting the backend.

## 🔐 Environment Variables

Sensitive information such as database credentials is stored in environment variables.

**Never upload your `.env` file or database passwords to GitHub.**

## 🎯 Project Objective

The primary objective of MediRoute is to improve emergency response coordination by providing a centralized platform for emergency registration, hospital selection, and ambulance dispatch.

## 🚀 Future Enhancements

- Real-time ambulance GPS tracking
- SMS and emergency notifications
- Advanced hospital availability management
- Driver-side mobile application
- Improved dispatch optimization

## 👨‍💻 Contributors

**MediRoute Development Team**

Built as an academic project to explore smart healthcare and emergency response management.

---

⭐ If you find this project interesting, consider giving the repository a star!

**MediRoute – Connecting Emergencies to Faster Response.**
