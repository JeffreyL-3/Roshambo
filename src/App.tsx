/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Trophy, User, Loader2, LogOut, Bot } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db } from './firebase';
import { signInAnonymously, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, doc, query, where, limit, getDocs, setDoc, updateDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';

type GameState = 'menu' | 'waiting' | 'playing' | 'result';
type Choice = 'rock' | 'paper' | 'scissors' | null;

const CHOICES = [
  { id: 'rock', emoji: '🪨', label: 'Rock' },
  { id: 'paper', emoji: '📄', label: 'Paper' },
  { id: 'scissors', emoji: '✂️', label: 'Scissors' }
] as const;

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [gameState, setGameState] = useState<GameState>('menu');
  
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(null);
  const [opponent, setOpponent] = useState<string | null>(null);
  const [myChoice, setMyChoice] = useState<Choice>(null);
  const [opponentChoice, setOpponentChoice] = useState<Choice>(null);
  const [opponentMadeChoice, setOpponentMadeChoice] = useState(false);
  const [scores, setScores] = useState({ me: 0, opponent: 0 });
  const [roundWinner, setRoundWinner] = useState<string | 'tie' | null>(null);
  const [isBotMatch, setIsBotMatch] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        signInAnonymously(auth).catch(e => {
          console.error(e);
          if (e.code === 'auth/admin-restricted-operation') {
             alert('Please enable "Anonymous" Authentication in your Firebase Console: go to Authentication -> Sign-in method, click "Add new provider", and enable "Anonymous".');
          } else {
             alert('Failed to login anonymously: ' + e.message);
          }
        });
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!currentMatchId || !user) return;
    
    const matchRef = doc(db, 'matches', currentMatchId);
    const unsub = onSnapshot(matchRef, (docSnap) => {
      if (!docSnap.exists()) return;
      const data = docSnap.data();
      
      if (data.status === 'abandoned') {
        alert('Opponent disconnected or match abandoned.');
        setCurrentMatchId(null);
        setGameState('menu');
        return;
      }

      setIsBotMatch(!!data.isBotMatch);

      if (data.status === 'waiting') {
        setGameState('waiting');
      } else if (data.status === 'playing' || data.status === 'result') {
        const oppId = data.isBotMatch ? `bot_${currentMatchId}` : data.players.find((p: string) => p !== user.uid);
        if (oppId) setOpponent(oppId);
        
        const myC = data.choices ? data.choices[user.uid] || null : null;
        const oppC = (data.choices && oppId) ? data.choices[oppId] || null : null;
        
        setMyChoice(myC);
        setOpponentMadeChoice(!!oppC);
        
        if (myC && oppC) {
           setOpponentChoice(oppC);
           let winner = 'tie';
           if (myC !== oppC) {
              if (
                (myC === "rock" && oppC === "scissors") ||
                (myC === "paper" && oppC === "rock") ||
                (myC === "scissors" && oppC === "paper")
              ) {
                winner = 'me';
              } else {
                winner = 'opponent';
              }
           }
           
           setRoundWinner(winner);
           setGameState('result');
           
           // Only the host (player 1) processes the round end
           if (user.uid === data.players[0]) {
             setTimeout(() => {
                const newScores = { ...data.scores };
                if (winner === 'me') newScores[user.uid] = (newScores[user.uid] || 0) + 1;
                else if (winner === 'opponent' && oppId) newScores[oppId] = (newScores[oppId] || 0) + 1;
                
                updateDoc(matchRef, {
                  choices: {}, // reset round
                  scores: newScores,
                  updatedAt: serverTimestamp()
                }).catch(console.error);
             }, 3000);
           }
        } else {
          setGameState('playing');
          setOpponentChoice(null);
          setRoundWinner(null);
        }
        
        if (oppId) {
          setScores({
            me: data.scores ? data.scores[user.uid] || 0 : 0,
            opponent: data.scores ? data.scores[oppId] || 0 : 0
          });
        }
      }
    }, (error) => {
      console.error(error);
      alert('Match sync error: ' + error.message);
      setCurrentMatchId(null);
      setGameState('menu');
    });

    return () => unsub();
  }, [currentMatchId, user]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (currentMatchId && (gameState === 'waiting' || (gameState === 'playing' && !isBotMatch))) {
        const matchRef = doc(db, 'matches', currentMatchId);
        updateDoc(matchRef, { 
          status: 'abandoned',
          updatedAt: serverTimestamp()
        }).catch(() => {});
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [currentMatchId, gameState, isBotMatch]);

  const joinMatchmaking = async () => {
    if (!user) return;
    setGameState('waiting');
    try {
      const matchesRef = collection(db, 'matches');
      const q = query(matchesRef, where('status', '==', 'waiting'), where('isBotMatch', '==', false), limit(1));
      const snapshot = await getDocs(q);
      
      let matchIdToJoin = null;
      let matchedDoc = null;
      
      if (!snapshot.empty) {
        matchedDoc = snapshot.docs[0];
        if (!matchedDoc.data().players.includes(user.uid)) {
            matchIdToJoin = matchedDoc.id;
        }
      }
      
      if (matchIdToJoin && matchedDoc) {
        const matchRef = doc(db, 'matches', matchIdToJoin);
        await updateDoc(matchRef, {
          players: [...matchedDoc.data().players, user.uid],
          status: 'playing',
          updatedAt: serverTimestamp()
        });
        setCurrentMatchId(matchIdToJoin);
      } else {
        const newMatchRef = doc(collection(db, 'matches'));
        await setDoc(newMatchRef, {
          status: 'waiting',
          players: [user.uid],
          choices: {},
          scores: { [user.uid]: 0 },
          isBotMatch: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        setCurrentMatchId(newMatchRef.id);
      }
    } catch (e: any) {
      console.error(e);
      setGameState('menu');
      alert('Failed to join matchmaking: ' + e.message);
    }
  };

  const playComputer = async () => {
    if (!user) return;
    try {
      const botId = `bot_${Date.now()}`;
      const newMatchRef = doc(collection(db, 'matches'));
      await setDoc(newMatchRef, {
        status: 'playing',
        players: [user.uid, botId],
        choices: {},
        scores: { [user.uid]: 0, [botId]: 0 },
        isBotMatch: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setCurrentMatchId(newMatchRef.id);
    } catch (e: any) {
      console.error(e);
      alert('Failed to start bot match: ' + e.message);
    }
  };

  const makeChoice = async (choice: Choice) => {
    if (!user || !currentMatchId || gameState !== 'playing' || myChoice) return;
    setMyChoice(choice);
    
    const matchRef = doc(db, 'matches', currentMatchId);
    
    if (isBotMatch) {
      const botChoice = CHOICES[Math.floor(Math.random() * CHOICES.length)].id;
      await updateDoc(matchRef, {
        [`choices.${user.uid}`]: choice,
        [`choices.bot_${currentMatchId}`]: botChoice,
        updatedAt: serverTimestamp()
      });
    } else {
      await updateDoc(matchRef, {
        [`choices.${user.uid}`]: choice,
        updatedAt: serverTimestamp()
      });
    }
  };

  const leaveMatch = async () => {
    if (currentMatchId) {
      const matchRef = doc(db, 'matches', currentMatchId);
      updateDoc(matchRef, {
        status: 'abandoned',
        updatedAt: serverTimestamp()
      }).catch(console.error);
    }
    setCurrentMatchId(null);
    setGameState('menu');
    setMyChoice(null);
    setOpponentChoice(null);
    setRoundWinner(null);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col items-center justify-center p-4 font-sans">
      <AnimatePresence mode="wait">
        {gameState === 'menu' && (
          <motion.div
            key="menu"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex flex-col items-center max-w-md w-full"
          >
            <div className="text-6xl mb-6 flex gap-4">
              <motion.span animate={{ rotate: [0, -20, 0] }} transition={{ repeat: Infinity, duration: 2 }}>🪨</motion.span>
              <motion.span animate={{ rotate: [0, 20, 0] }} transition={{ repeat: Infinity, duration: 2, delay: 0.3 }}>📄</motion.span>
              <motion.span animate={{ rotate: [0, -20, 0] }} transition={{ repeat: Infinity, duration: 2, delay: 0.6 }}>✂️</motion.span>
            </div>
            <h1 className="text-4xl font-bold mb-2 tracking-tight">Roshambo</h1>
            <p className="text-zinc-400 mb-8 text-center">Online Multiplayer Rock Paper Scissors</p>
            
            <div className="w-full space-y-4">
              <button
                onClick={joinMatchmaking}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-4 px-8 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <User className="w-5 h-5" />
                Find Opponent
              </button>
              <button
                onClick={playComputer}
                className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold py-4 px-8 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <Bot className="w-5 h-5" />
                Play Computer
              </button>
            </div>
          </motion.div>
        )}

        {gameState === 'waiting' && (
          <motion.div
            key="waiting"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="flex flex-col items-center"
          >
            <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-6" />
            <h2 className="text-2xl font-semibold mb-2">Searching for opponent...</h2>
            <p className="text-zinc-400 mb-8">Please wait while we find a match</p>
            
            <button
              onClick={leaveMatch}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
          </motion.div>
        )}

        {(gameState === 'playing' || gameState === 'result') && (
          <motion.div
            key="game"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="w-full max-w-2xl flex flex-col h-[80vh]"
          >
            {/* Header / Scoreboard */}
            <div className="flex justify-between items-center bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800 mb-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm text-zinc-400">You</div>
                  <div className="font-bold text-xl">{scores.me}</div>
                </div>
              </div>
              
              <div className="flex flex-col items-center">
                <Trophy className="w-6 h-6 text-yellow-500 mb-1" />
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-widest">Score</span>
              </div>

              <div className="flex items-center gap-3 text-right">
                <div>
                  <div className="text-sm text-zinc-400">{isBotMatch ? 'Computer' : 'Opponent'}</div>
                  <div className="font-bold text-xl">{scores.opponent}</div>
                </div>
                <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center text-rose-400">
                  {isBotMatch ? <Bot className="w-5 h-5" /> : <User className="w-5 h-5" />}
                </div>
              </div>
            </div>

            {/* Battle Area */}
            <div className="flex-1 flex flex-col justify-center items-center relative">
              <div className="flex justify-between w-full items-center px-8">
                {/* My Side */}
                <div className="flex flex-col items-center">
                  <div className={`w-32 h-32 rounded-3xl flex items-center justify-center text-6xl bg-zinc-900 border-2 transition-all ${myChoice ? 'border-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.2)]' : 'border-zinc-800'}`}>
                    {myChoice ? CHOICES.find(c => c.id === myChoice)?.emoji : '?'}
                  </div>
                  <div className="mt-4 text-zinc-400 font-medium tracking-wide">YOU</div>
                </div>

                <div className="text-3xl font-bold text-zinc-700">VS</div>

                {/* Opponent Side */}
                <div className="flex flex-col items-center">
                  <div className={`w-32 h-32 rounded-3xl flex items-center justify-center text-6xl bg-zinc-900 border-2 transition-all ${opponentChoice ? 'border-rose-500 shadow-[0_0_30px_rgba(244,63,94,0.2)]' : opponentMadeChoice ? 'border-emerald-500' : 'border-zinc-800'}`}>
                    {opponentChoice ? CHOICES.find(c => c.id === opponentChoice)?.emoji : opponentMadeChoice ? '✓' : '?'}
                  </div>
                  <div className="mt-4 text-zinc-400 font-medium tracking-wide">{isBotMatch ? 'COMPUTER' : 'OPPONENT'}</div>
                </div>
              </div>

              {/* Result Overlay */}
              <AnimatePresence>
                {gameState === 'result' && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.8, y: -20 }}
                    className="absolute inset-0 flex items-center justify-center pointer-events-none"
                  >
                    <div className="bg-zinc-950/90 backdrop-blur-sm px-8 py-4 rounded-full border border-zinc-800 shadow-2xl">
                      <h2 className={`text-3xl font-bold ${
                        roundWinner === 'me' ? 'text-emerald-400' : 
                        roundWinner === 'opponent' ? 'text-rose-400' : 
                        'text-zinc-400'
                      }`}>
                        {roundWinner === 'me' ? 'You Won!' : 
                         roundWinner === 'opponent' ? 'You Lost!' : 
                         'Draw!'}
                      </h2>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Controls */}
            <div className="mt-8">
              <div className="flex justify-center gap-4 mb-8">
                {CHOICES.map(choice => (
                  <button
                    key={choice.id}
                    onClick={() => makeChoice(choice.id as Choice)}
                    disabled={gameState !== 'playing' || myChoice !== null}
                    className={`w-24 h-24 rounded-2xl text-4xl flex items-center justify-center transition-all
                      ${myChoice === choice.id 
                        ? 'bg-indigo-600 shadow-[0_0_20px_rgba(99,102,241,0.4)] scale-110' 
                        : 'bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700'
                      }
                      ${(gameState !== 'playing' || myChoice !== null) && myChoice !== choice.id ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'}
                    `}
                  >
                    {choice.emoji}
                  </button>
                ))}
              </div>
              
              <div className="flex justify-center">
                <button
                  onClick={leaveMatch}
                  className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 transition-colors px-4 py-2 rounded-lg hover:bg-zinc-900"
                >
                  <LogOut className="w-4 h-4" />
                  Leave Match
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

