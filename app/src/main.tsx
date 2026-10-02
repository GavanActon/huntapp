import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import './ui.css'
import App from './App'
import { initDevlog } from './devlog'
import { installErrorLog } from './diagnostics'

// before the first render: the dev log's switch and lines from the last
// session, and the console's errors into the ring the snapshot reports
initDevlog()
installErrorLog()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
