# ♟️ YayChess

YayChess is a premium, real-time online multiplayer chess application designed with a focus on stunning aesthetics, smooth animations, and competitive integrity. Built with Node.js and Socket.io, it provides a seamless matchmaking experience and robust chess logic.

## 🚀 Key Features

- **Live Multiplayer:** Real-time matchmaking with a global lobby system.
- **Advanced Time Controls:** Supports Bullet, Blitz, and Rapid formats with synchronized countdown timers and **time increments** (e.g., 2+1, 3+2).
- **Rule-Complete Logic:** Full check/checkmate detection and legal move validation.
- **In-Game Action Bar:** Easily Resign, Propose Draws, or Flip the board view.
- **Contextual Game Chat:** Automatic sidebar switching between the player lobby and a real-time game chat during matches.
- **Board Orientation:** Automatic board flipping based on your assigned color (White/Black).
- **Customizable Themes:** Choose between Classic Green, Warm Walnut, and Dark Glass styles.
- **Modern UI:** Responsive design with premium dark-mode aesthetics, pulse loaders, and sleek overlays.

## 🛠️ Tech Stack

- **Frontend:** Vanilla JavaScript, HTML5, CSS3 (Custom Design System).
- **Backend:** Node.js, Express.
- **Real-time:** Socket.io for low-latency state synchronization.
- **Deployment:** Docker.

---

## 📦 Deployment Instructions

### Method 1: Docker (Recommended)

YayChess is containerized for consistent deployment across any environment.

#### Pull from Registry
You can pull the latest image from either Docker Hub or GitHub Container Registry:

```bash
# From Docker Hub
docker pull maskedmatters/yaychess:latest

# From GitHub Container Registry
docker pull ghcr.io/maskedmatters/yaychess:latest
```

#### Run the Container
```bash
docker run -d -p 3000:3000 --name yaychess maskedmatters/yaychess:latest
```
Access the app at `http://localhost:3000`.

#### Build from Source
If you have the source code locally:
```bash
docker build -t yaychess .
docker run -p 3000:3000 yaychess
```

---

### Method 2: Manual Node.js Installation

If you prefer to run the application directly on your host machine:

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Start the Server:**
   ```bash
   npm start
   ```
   The server will find the first available port (starting at 3000).

---

## 🤝 Rules of Engagement

- **Draw Offers:** Draw proposals now use a dedicated UI modal. You must explicitly accept or decline.
- **Matchmaking:** Select your preferred color (White, Black, or Random) before sending a challenge. The server will automatically assign roles.
- **Timeouts:** If your clock hits 0:00, the game is automatically forfeited.

## 🛡️ License
Distributed under the ISC License. See `package.json` for details.

---
