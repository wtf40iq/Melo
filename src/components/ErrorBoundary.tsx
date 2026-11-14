import { Component, ErrorInfo, ReactNode } from "react";

/** Ошибка рендера не должна оставлять пользователя с белым экраном. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Melo UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const ru = !navigator.language || navigator.language.toLowerCase().startsWith("ru");
    return (
      <div style={{ height: "100vh", display: "grid", placeItems: "center", background: "#121212", color: "#fff", fontFamily: "Segoe UI, sans-serif", padding: 24, textAlign: "center" }}>
        <div style={{ maxWidth: 460, display: "grid", gap: 12 }}>
          <b style={{ fontSize: 20 }}>{ru ? "Что-то сломалось" : "Something broke"}</b>
          <span style={{ color: "rgba(255,255,255,.65)", lineHeight: 1.5 }}>
            {ru ? "Melo столкнулся с ошибкой интерфейса. Перезапустите приложение — музыка и вход сохранятся." : "Melo hit a UI error. Restart the app — your music and sign-in are safe."}
          </span>
          <button
            onClick={() => location.reload()}
            style={{ justifySelf: "center", marginTop: 8, padding: "10px 18px", borderRadius: 20, border: 0, background: "#5e9fe8", color: "#0b1a2b", fontWeight: 600, cursor: "pointer" }}
          >
            {ru ? "Перезапустить" : "Restart"}
          </button>
          <small style={{ color: "rgba(255,255,255,.35)", wordBreak: "break-word" }}>{String(this.state.error.message || this.state.error)}</small>
        </div>
      </div>
    );
  }
}
