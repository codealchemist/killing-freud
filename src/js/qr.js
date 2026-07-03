import QRCode from 'qrcode'

export async function renderQR(canvasEl, url) {
  await QRCode.toCanvas(canvasEl, url, {
    width: 200,
    margin: 2,
    color: {
      dark: '#e8e8e8',
      light: '#111111'
    }
  })
}
