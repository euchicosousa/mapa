// Explicit auth actions own their redirects and their privacy lock. SDK events
// still update the observed identity, but must not race the action's navigation.
let running = 0;
export function beginAuthAction() {
  running += 1;
  return () => { running -= 1; };
}
export const authActionRunning = () => running > 0;
