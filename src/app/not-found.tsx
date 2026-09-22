export default function NotFound() {
  return (
    <main
      data-status="SAFE"
      style={{
        minHeight: "100svh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: "1.5rem",
        padding: "clamp(1.5rem, 5vw, 4rem)",
      }}
    >
      <div className="boot" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <h1 className="heading" style={{ fontSize: "clamp(3rem, 14vw, 9rem)" }}>
          404
          <span className="cursor" aria-hidden="true" />
        </h1>
        <p className="caption">NO SUCH PAGE.</p>
      </div>
    </main>
  );
}
