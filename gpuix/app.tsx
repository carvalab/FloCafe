// FloCafe native entry. Must end with render() and be run with `bun --hot`:
// each save re-runs this file and remounts React on the same window.
import { render } from '@gpuix/react'
import { App } from './src/App'

render(<App />, { title: 'FloCafe', width: 1024, height: 680 })
