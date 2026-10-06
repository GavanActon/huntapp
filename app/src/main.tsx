import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import './ui.css'
import App from './App'
import { initAnalytics } from './analytics'
import { initDevlog } from './devlog'
import { installErrorLog } from './diagnostics'
import { initCheckShare } from './weather/micro/checkShare'

// before the first render: the dev log's switch and lines from the last
// session, the console's errors into the ring the snapshot reports, the
// usage stats (the launch, the taps, the errors) and the shared wind checks
initDevlog()
installErrorLog()
initAnalytics()
initCheckShare()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
