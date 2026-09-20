declare module "plotly.js-basic-dist-min" {
  const Plotly: {
    react(el: HTMLElement, data: unknown[], layout: unknown, config?: unknown): Promise<PlotlyElement>;
    relayout(el: HTMLElement, update: Record<string, unknown>): Promise<void>;
    purge(el: HTMLElement): void;
    Plots: { resize(el: HTMLElement): void };
  };
  export interface PlotlyElement extends HTMLElement {
    on(event: string, handler: (e: Record<string, unknown>) => void): void;
    removeAllListeners?(event: string): void;
  }
  export default Plotly;
}
