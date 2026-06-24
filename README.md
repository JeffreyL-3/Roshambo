# Roshambo

Rock, paper, scissors... online!

Roshambo is a real-time multiplayer rock-paper-scissors game built with React, Vite, and Firebase.

## Capabilities

- **1v1 Online Matches:** Play against another human player in real-time.
- **3-Way Online Matches:** Play a 3-player match where you earn points corresponding to the number of opponents you beat.
- **Play Against Computer:** Play against a bot offline or when no opponents are available.
- **Real-Time Sync:** Game states, choices, and scores are synchronized instantly using Firestore's real-time listeners.
- **Matchmaking:** Automatically finds and connects players looking for 1v1 or 3-way matches.
- **Anonymous Authentication:** Seamlessly join the game without the need to create an account.
- **Responsive UI:** A beautifully animated, responsive interface using Framer Motion and Tailwind CSS.

## Architecture

- **Frontend:** React (TypeScript), Vite, Tailwind CSS, Framer Motion, Lucide React.
- **Backend/Database:** Firebase Firestore (NoSQL Document Database) for real-time match state synchronization.
- **Authentication:** Firebase Anonymous Authentication.
- **Hosting/Deployment:** Configured for deployment to GitHub Pages via GitHub Actions.

The game uses Firestore collections (`matches`) to keep track of game state, players, choices, and scores. Firestore security rules ensure that only authenticated players can join and update matches.
