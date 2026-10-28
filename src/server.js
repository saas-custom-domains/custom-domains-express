import { createApp } from './app.js'

const port = Number(process.env.PORT ?? 3000)

createApp().listen(port, (err) => {
  if (err) throw err
  console.log(`Listening on http://localhost:${port}`)
})
