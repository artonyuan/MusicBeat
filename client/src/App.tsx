import { useGameStore } from './store/gameStore';
import UploadScreen from './components/UploadScreen';
import LoadingScreen from './components/LoadingScreen';
import GameScreen from './components/GameScreen';
import ResultsScreen from './components/ResultsScreen';
import RunPage from './components/RunPage';

function App() {
  const screen = useGameStore((state) => state.screen);
  const runId = new URLSearchParams(window.location.search).get('run');

  if (runId) {
    return <RunPage runId={runId} />;
  }

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {screen === 'upload' && <UploadScreen />}
      {screen === 'loading' && <LoadingScreen />}
      {screen === 'playing' && <GameScreen />}
      {screen === 'results' && <ResultsScreen />}
    </div>
  );
}

export default App;
