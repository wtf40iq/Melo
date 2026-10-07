export function Loading({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-label="Загрузка">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk-row">
          <i className="sk-cover" />
          <span><i style={{ width: `${40 + ((i * 37) % 30)}%` }} /><i style={{ width: `${20 + ((i * 23) % 20)}%` }} /></span>
        </div>
      ))}
    </div>
  );
}

export function Empty({ title, text }: { title: string; text?: string }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {text && <span>{text}</span>}
    </div>
  );
}
