import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import './ui.css'
import App from './App'
import { initAnalytics } from './analytics'
import { initDevlog } from './devlog'
import { installErrorLog } from './diagnostics'
import { initFullHeight } from './ui/fullHeight'
import { initCheckShare } from './weather/micro/checkShare'

// before the first render: the dev log's switch and lines from the last
// session, the console's errors into the ring the snapshot reports, the
// usage stats (the launch, the taps, the errors) and the shared wind checks;
// the page as tall as the screen in the installed app on an iPhone
initDevlog()
installErrorLog()
initFullHeight()
initAnalytics()
initCheckShare()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
