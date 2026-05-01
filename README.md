# ☕ Expresso — Intelligent Café Decision System

Expresso is a full-stack web application designed to simplify group-based café selection.
Rather than merely listing locations, the system focuses on **decision support**, enabling users to collaboratively determine optimal choices based on shared preferences.
<img width="1920" height="1080" alt="Screenshot (2482)" src="https://github.com/user-attachments/assets/3fbecce9-cc17-4275-87b8-ceb96477e08f" />
<img width="1920" height="1080" alt="Screenshot (2483)" src="https://github.com/user-attachments/assets/95582c14-fdf7-4359-9680-c518fac552ff" />
<img width="1920" height="1080" alt="Screenshot (2508)" src="https://github.com/user-attachments/assets/68f44d9e-8a83-4922-ba7f-89e16915e671" />
<img width="1920" height="914" alt="Screenshot (2510)" src="https://github.com/user-attachments/assets/a012477b-7ce2-4f2c-a083-9adcb1cee544" />

---

## 🚀 Overview

Expresso was developed as a complete end-to-end system integrating:

* **Frontend Interface** for user interaction
* **Backend API Layer** for request handling
* **Database Integration** for persistent storage
* **Authentication System** for identity management

The application demonstrates how multiple layers of a modern web system interact to form a cohesive product.

---

## 🧱 Tech Stack

### Frontend

* Next.js (App Router)
* React
* TypeScript

### Backend

* Next.js API Routes
* Server-side logic using modern JavaScript/TypeScript

### Database

* MongoDB Atlas
* Mongoose ODM

### Authentication

* NextAuth (Credentials Provider)
* bcrypt for password hashing

### Deployment

* Vercel

---

## 🔐 Core Features

### 1. User Authentication

* Secure signup and login system
* Password hashing using bcrypt
* Session-based authentication via NextAuth

### 2. Persistent Sessions

* User identity maintained across requests
* Protected routes based on authentication state

### 3. Database Integration

* User data stored in MongoDB
* Structured schema using Mongoose

### 4. API Architecture

* RESTful API routes
* JSON-based request/response handling
* Error-safe backend design

### 5. Scalable Foundation

* Designed to support future features such as:

  * group decision-making
  * café recommendations
  * user preferences and favorites

---

## ⚙️ Getting Started

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd expresso
```

---

### 2. Install dependencies

```bash
npm install
```

---

### 3. Configure environment variables

Create a `.env.local` file:

```env
MONGODB_URI=your_mongodb_connection_string
NEXTAUTH_SECRET=your_generated_secret
NEXTAUTH_URL=http://localhost:3000
```

---

### 4. Run the development server

```bash
npm run dev
```

Open:

```
http://localhost:3000
```

---

## 🧠 Key Learnings

This project was not limited to feature implementation. It involved:

* Debugging multi-layer system interactions
* Managing environment-specific configurations
* Handling authentication and session logic
* Understanding client-server communication deeply
* Resolving real-world deployment issues

The development process emphasized **system thinking**, not just coding.

---

## 🌍 Deployment

The application is deployed using Vercel.

Production considerations included:

* environment variable configuration
* secure authentication setup
* database access control

---

## 📌 Future Enhancements

* Group-based café decision engine
* Real-time collaboration features
* Recommendation algorithms
* Enhanced UI/UX interactions

---

## 📄 Documentation

A detailed technical breakdown of the entire development process is included in the project documentation, covering:

* system architecture
* debugging strategies
* authentication flow
* deployment challenges

---

## 🤝 Contribution

This project is currently under active development. Contributions, suggestions, and feedback are welcome.

---

## 📜 License

This project is open-source and available under the MIT License.

---

## ✨ Closing Note

Expresso represents the transition from building isolated features to designing and understanding complete systems.

It is not only a product, but a study of how modern web applications behave under real-world conditions.
