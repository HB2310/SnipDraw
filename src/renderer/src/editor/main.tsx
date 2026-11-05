import './asset-path' // must run before Excalidraw is imported
import { createRoot } from 'react-dom/client'
import excalidrawCss from '@excalidraw/excalidraw/index.css?raw'
import { darkChromeCss } from '../../../shared/dark-chrome'
import { Editor } from './Editor'
import '@excalidraw/excalidraw/index.css'
import './editor.css'

// Dark UI chrome on top of Excalidraw's light (unfiltered) canvas.
const style = document.createElement('style')
style.dataset.snipdraw = 'dark-chrome'
style.textContent = darkChromeCss(excalidrawCss)
document.head.appendChild(style)

createRoot(document.getElementById('root')!).render(<Editor />)
