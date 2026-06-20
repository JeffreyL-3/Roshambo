/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Trophy, User, Loader2, LogOut, Bot, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db } from './firebase';
import { signInAnonymously, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, doc, query, where, limit, getDocs, setDoc, updateDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';

type GameState = 'menu' | 'waiting' | 'playing' | 'result';
type Choice = 'rock' | 'paper' | 'scissors' | null;

function beats(c1: Choice | string, c2: Choice | string) {
  if (c1 === 'rock' && c2 === 'scissors') return true;
  if (c1 === 'paper' && c2 === 'rock') return true;
  if (c1 === 'scissors' && c2 === 'paper') return true;
  return false;
}

const CHOICES = [
  { id: 'rock', emoji: '🪨', label: 'Rock' },
  { id: 'paper', emoji: '📄', label: 'Paper' },
  { id: 'scissors', emoji: '✂️', label: 'Scissors' }
] as const;

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [gameState, setGameState] = useState<GameState>('menu');
  
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(null);
  const [myChoice, setMyChoice] = useState<Choice>(null);
  const [myScore, setMyScore] = useState(0);
  
  const [opponents, setOpponents] = useState<{ id: string, choice: Choice, madeChoice: boolean, score: number, name: string }[]>([]);
  const [roundMessage, setRoundMessage] = useState<string>('');
  const [roundWinnerColor, setRoundWinnerColor] = useState<'me' | 'opponent' | 'tie'>('tie');
  
  const [isBotMatch, setIsBotMatch] = useState(false);
  const [isThreeWay, setIsThreeWay] = useState(false);

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
        alert('Someone disconnected or match abandoned.');
        setCurrentMatchId(null);
        setGameState('menu');
        return;
      }

      setIsBotMatch(!!data.isBotMatch);
      setIsThreeWay(!!data.isThreeWay);

      if (data.status === 'waiting') {
        setGameState('waiting');
      } else if (data.status === 'playing' || data.status === 'result') {
        const oppIds = data.players.filter((p: string) => p !== user.uid);
        if (data.isBotMatch) oppIds.push(`bot_${currentMatchId}`);
        
        const newOpponents = oppIds.map((id: string, index: number) => ({
             id,
             choice: data.choices ? data.choices[id] || null : null,
             madeChoice: data.choices ? !!data.choices[id] : false,
             score: data.scores ? data.scores[id] || 0 : 0,
             name: data.isBotMatch ? 'Computer' : (data.isThreeWay ? `Opponent ${index + 1}` : 'Opponent')
        }));
        setOpponents(newOpponents);
        
        const myC = data.choices ? data.choices[user.uid] || null : null;
        setMyChoice(myC);
        setMyScore(data.scores ? data.scores[user.uid] || 0 : 0);
        
        const requiredPlayers = !!data.isThreeWay ? 3 : 2;
        const allChosen = data.choices && Object.keys(data.choices).length === requiredPlayers;

        if (allChosen && myC) {
           let color: 'me' | 'opponent' | 'tie' = 'tie';
           let msg = '';
           
           if (!data.isThreeWay) {
               const oppC = newOpponents[0].choice;
               if (myC !== oppC) {
                  if (beats(myC, oppC)) color = 'me';
                  else color = 'opponent';
               }
               msg = color === 'me' ? 'You Won!' : color === 'opponent' ? 'You Lost!' : 'Draw!';
           } else {
               const myBeats = newOpponents.filter(opp => opp.choice && beats(myC, opp.choice)).length;
               color = myBeats > 0 ? 'me' : 'tie';
               msg = `You earned +${myBeats} points!`;
           }
           
           setRoundWinnerColor(color);
           setRoundMessage(msg);
           setGameState('result');
           
           if (user.uid === data.players[0]) {
             setTimeout(() => {
                const newScores = { ...data.scores };
                
                const allIds = [...data.players];
                if (data.isBotMatch) allIds.push(`bot_${currentMatchId}`);
                
                allIds.forEach(p1 => {
                   let points = 0;
                   allIds.forEach(p2 => {
                     if (p1 !== p2 && data.choices[p1] && data.choices[p2] && beats(data.choices[p1], data.choices[p2])) {
                        points++;
                     }
                   });
                   newScores[p1] = (newScores[p1] || 0) + points;
                });

                updateDoc(matchRef, {
                  choices: {},
                  scores: newScores,
                  updatedAt: serverTimestamp()
                }).catch(console.error);
             }, 3000);
           }
        } else {
          setGameState('playing');
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

  const joinMatchmaking = async (threeWay: boolean = false) => {
    if (!user) return;
    setGameState('waiting');
    try {
      const matchesRef = collection(db, 'matches');
      const q = query(
        matchesRef, 
        where('status', '==', 'waiting'), 
        where('isBotMatch', '==', false), 
        where('isThreeWay', '==', threeWay), 
        limit(1)
      );
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
        const newPlayers = [...matchedDoc.data().players, user.uid];
        const matchRef = doc(db, 'matches', matchIdToJoin);
        await updateDoc(matchRef, {
          players: newPlayers,
          status: newPlayers.length === (threeWay ? 3 : 2) ? 'playing' : 'waiting',
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
          isThreeWay: threeWay,
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
        isThreeWay: false,
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
  };

  const renderPlayerSide = (title: string, choiceKey: 'me' | 'opp', opp?: {choice: Choice, madeChoice: boolean, name: string}) => {
    const madeChoice = choiceKey === 'me' ? !!myChoice : !!opp?.madeChoice;
    const choice = choiceKey === 'me' ? myChoice : (gameState === 'result' ? opp?.choice : null);
    
    let borderColor = 'border-zinc-800';
    if (choiceKey === 'me') {
       if (myChoice) borderColor = 'border-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.2)]';
    } else {
       if (gameState === 'result' && choice) borderColor = 'border-rose-500 shadow-[0_0_30px_rgba(244,63,94,0.2)]';
       else if (madeChoice) borderColor = 'border-emerald-500';
    }

    return (
      <div className="flex flex-col items-center flex-1 min-w-[140px]">
        <div className={`w-32 h-32 rounded-3xl flex items-center justify-center text-6xl bg-zinc-900 border-2 transition-all ${borderColor}`}>
          {choice ? CHOICES.find(c => c.id === choice)?.emoji : madeChoice ? '✓' : '?'}
        </div>
        <div className="mt-4 text-zinc-400 font-medium tracking-wide uppercase text-center truncate w-32">{title}</div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col items-center justify-center p-4 font-sans overflow-hidden">
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
                onClick={() => joinMatchmaking(false)}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-4 px-8 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <User className="w-5 h-5" />
                Find Opponent (1v1)
              </button>
              <button
                onClick={() => joinMatchmaking(true)}
                className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold py-4 px-8 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <Users className="w-5 h-5" />
                Online 3-Way
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
            <h2 className="text-2xl font-semibold mb-2">Searching for opponents...</h2>
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
            className="w-full max-w-4xl flex flex-col h-[80vh]"
          >
            {/* Header / Scoreboard */}
            <div className="flex justify-between items-center bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800 mb-8 overflow-x-auto">
              <div className="flex items-center gap-3 pr-4 border-r border-zinc-800">
                <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 flex-shrink-0">
                  <User className="w-5 h-5" />
                </div>
                <div className="min-w-16">
                  <div className="text-sm text-zinc-400">You</div>
                  <div className="font-bold text-xl">{myScore}</div>
                </div>
              </div>
              
              <div className="flex flex-col items-center px-4 flex-shrink-0 hidden sm:flex">
                <Trophy className="w-6 h-6 text-yellow-500 mb-1" />
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-widest">Score</span>
              </div>

              <div className="flex items-center gap-6 pl-4 border-l border-zinc-800 overflow-x-auto scrollbar-default py-1 ml-auto">
                {opponents.map(opp => (
                  <div key={opp.id} className="flex items-center gap-3 text-right">
                    <div className="min-w-16">
                      <div className="text-sm text-zinc-400 truncate w-20" title={opp.name}>{opp.name}</div>
                      <div className="font-bold text-xl">{opp.score}</div>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center text-rose-400 flex-shrink-0">
                      {opp.name === 'Computer' ? <Bot className="w-5 h-5" /> : <User className="w-5 h-5" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Battle Area */}
            <div className="flex-1 flex flex-col justify-center items-center relative">
              <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-4 sm:gap-8 w-full items-center px-4">
                {/* My Side */}
                {renderPlayerSide('YOU', 'me')}

                {/* Opponent Sides */}
                {opponents.map(opp => (
                   <div key={opp.id} className="flex flex-col sm:flex-row gap-4 sm:gap-8 items-center">
                     <div className="text-3xl font-bold text-zinc-700">VS</div>
                     {renderPlayerSide(opp.name, 'opp', opp)}
                   </div>
                ))}
              </div>

              {/* Result Overlay */}
              <AnimatePresence>
                {gameState === 'result' && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.8, y: -20 }}
                    className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none z-10"
                  >
                    <div className="bg-zinc-950/95 backdrop-blur-md px-10 py-6 rounded-full border border-zinc-800 shadow-2xl">
                      <h2 className={`text-4xl font-bold ${
                        roundWinnerColor === 'me' ? 'text-emerald-400' : 
                        roundWinnerColor === 'opponent' ? 'text-rose-400' : 
                        'text-zinc-400'
                      }`}>
                        {roundMessage}
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
