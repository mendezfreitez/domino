import { FormEvent, useEffect, useState } from "react";
import { emitCreateRoom, emitJoinRoom } from "../../services/socket";
import "./Home.css";

interface HomeProps {
  initialName: string;
  onNameChange: (name: string) => void;
  onClearError: () => void;
  error: string | null;
}

export function Home({ initialName, onNameChange, onClearError, error }: HomeProps) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (error) setJoining(false);
  }, [error]);

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    onNameChange(name);
    onClearError();
    setJoining(false);
    emitCreateRoom(name);
  };

  const handleJoin = (e: FormEvent) => {
    e.preventDefault();
    onNameChange(name);
    onClearError();
    setJoining(true);
    emitJoinRoom(code, name);
  };

  return (
    <div className="home">
      <header className="home-header">
        <h1 className="home-title">Dominó Online</h1>
        <p className="home-subtitle">
          Doble-Seis · 2 vs 2 · 28 fichas
        </p>
      </header>

      <section className="home-card">
        <label className="home-label" htmlFor="player-name">
          Tu nombre
        </label>
        <input
          id="player-name"
          type="text"
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej. Daniel"
          autoComplete="off"
        />

        <form onSubmit={handleCreate}>
          <button type="submit" className="primary home-create">
            Crear partida
          </button>
        </form>

        <div className="home-divider"><span>o únete con un código</span></div>

        <form onSubmit={handleJoin} className="home-join-form">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Código de sala, ej. A7K92"
            maxLength={5}
            autoComplete="off"
          />
          <button type="submit" disabled={code.length !== 5}>
            {joining ? "Uniéndose…" : "Unirse"}
          </button>
        </form>

        {error && <div className="error-banner home-error">{error}</div>}
      </section>
    </div>
  );
}