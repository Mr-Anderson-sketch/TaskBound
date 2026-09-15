// renderer/main — reads `location.hash` and mounts the right route's app. One bundle,
// three windows (strip/palette/planner), each loading this same entry with a
// different `#/route`. See CLAUDE.md and the brief's Part B "Routing".
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { StripApp } from './strip/StripApp';
import { PaletteApp } from './palette/PaletteApp';
import { PlannerApp } from './planner/PlannerApp';

type Route = 'strip' | 'palette' | 'planner';

function routeFromHash(): Route {
  const hash = location.hash.replace(/^#\/?/, '');
  if (hash === 'palette') return 'palette';
  if (hash === 'planner') return 'planner';
  return 'strip';
}

const route = routeFromHash();
document.body.dataset.route = route;

const App = route === 'palette' ? PaletteApp : route === 'planner' ? PlannerApp : StripApp;

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
