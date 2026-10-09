// Renders resources/icon.svg to resources/icon.png (1024) and resources/icon.ico.
// Run with: npm run icon
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(import.meta.dirname, '..', 'resources')
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/** An .ico that holds each size as an embedded PNG. */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i
    header.writeUInt8(size % 256, at)
    header.writeUInt8(size % 256, at + 1)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(png.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...images.map((i) => i.png)])
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const svg = readFileSync(join(dir, 'icon.svg')).toString('base64')
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  })
  const html = `<body style="margin:0;overflow:hidden"><img src="data:image/svg+xml;base64,${svg}" style="display:block;width:100vw;height:100vh">`
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
  await new Promise((r) => setTimeout(r, 300))
  const full = (await win.webContents.capturePage()).resize({ width: 1024, height: 1024, quality: 'best' })
  writeFileSync(join(dir, 'icon.png'), full.toPNG())
  const images = ICO_SIZES.map((size) => ({ size, png: full.resize({ width: size, height: size, quality: 'best' }).toPNG() }))
  writeFileSync(join(dir, 'icon.ico'), ico(images))
  app.quit()
})
