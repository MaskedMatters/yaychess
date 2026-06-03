# ♟️ YayChess (v1.2.4-p)

YayChess is a premium, real-time online multiplayer chess application designed with a focus on stunning aesthetics, smooth animations, and competitive integrity. Built with Node.js and Socket.io, it provides a seamless matchmaking experience and robust chess logic.

## 🚀 Key Features

- **Live Multiplayer:** Real-time matchmaking with a global lobby system and persistent player sessions.
- **Advanced Synchronized Timers:** Server-authoritative timing system with millisecond precision. Clocks automatically switch to **tenths-of-a-second** when under 10 seconds to ensure competitive accuracy.
- **Chained Premoves:** Queue multiple moves during your opponent's turn. Pieces move visually on your board immediately, allowing you to chain complex sequences (including virtual promotions) that play automatically when your turn arrives.
- **Intuitive Interaction:** Support for both classic **click-to-move** and modern **drag-and-drop** mechanics. Dragging includes visual ghosting and target square highlights.
- **Smooth Animations:** Buttery-smooth piece transitions for click-initiated and opponent moves, optimized with CSS hardware acceleration.
- **Analysis & Visuals:** 
    - **Right-click Highlights:** Toggle solid red square highlights for positional marking.
    - **Dynamic Arrows:** Draw perfectly centered, equilateral orange arrows by right-click-dragging. Uniform transparency and rounded geometry for a professional look.
- **Rule-Complete Logic:** Full check/checkmate/stalemate detection, en passant, castling, and a **Promotion Dialog** (Queen, Rook, Bishop, Knight).
- **In-Game Action Bar:** Easily Resign, Propose Draws, or Flip the board view.
- **Customizable Themes:** Choose between Classic Green, Warm Walnut, and Dark Glass styles with soft, desaturated golden move indicators.

## 🛠️ Tech Stack

- **Frontend:** Vanilla JavaScript (ES6+), SVG Graphics, CSS3 (Custom Design Tokens).
- **Backend:** Node.js, Express.
- **Real-time:** Socket.io for low-latency state and timer synchronization.
- **Deployment:** Docker.

---

## 📦 Deployment Instructions

### Method 1: Docker (Recommended)

YayChess is containerized for consistent deployment across any environment.

#### Pull from Registry
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

---

### Method 2: Manual Node.js Installation

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

- **Draw Offers:** Draw proposals use a dedicated UI modal. You must explicitly accept or decline.
- **Matchmaking:** Select your preferred color (White, Black, or Random) before sending a challenge.
- **Authoritative Time:** Clocks are synced to the server timestamp. If your authoritative time hits 0.0, the game is automatically forfeited.

## 🛡️ License
Distributed under the MIT License. See `package.json` for details.

---
