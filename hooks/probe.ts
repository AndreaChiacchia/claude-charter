import type { ClientModule } from 'claude-code'

/** Measures the cells the route row may take under the prompt and posts them to the hooks module when they change, or when the hooks module asks. */
const probe: ClientModule<{ ask: boolean }, { posted: number; ask: boolean }> = (props, surface) => {
  const n = surface.columns
  const seen = surface.state
  if (n > 0 && (seen === undefined || seen.posted !== n || seen.ask !== props.ask)) {
    surface.post({ columns: n })
    surface.setState({ posted: n, ask: props.ask })
  }

  return surface.elements.Box({ height: 0 })
}

export default probe
