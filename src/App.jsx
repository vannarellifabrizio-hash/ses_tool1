import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function parseISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}
function formatITDateTime(ms) {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}
function safeText(s) { return (s ?? "").toString().trim(); }
function daysBetween(a, b) {
  const ms = 24 * 60 * 60 * 1000;
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.floor((db.getTime() - da.getTime()) / ms);
}

function exportActivitiesPdf({ projects, profiles, activities, filters, title }) {
  const projectById = new Map(projects.map(p => [p.id, p]));
  const profById = new Map(profiles.map(p => [p.id, p]));

  const filtered = activities.filter(a => {
    if (filters?.projectId && a.project_id !== filters.projectId) return false;
    if (filters?.userId && a.user_id !== filters.userId) return false;
    if (filters?.fromDate) {
      const from = parseISODate(filters.fromDate);
      if (new Date(a.created_at).getTime() < from.getTime()) return false;
    }
    if (filters?.toDate) {
      const to = parseISODate(filters.toDate);
      const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
      if (new Date(a.created_at).getTime() > end.getTime()) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const pa = projectById.get(a.project_id)?.title || "";
    const pb = projectById.get(b.project_id)?.title || "";
    const pc = pa.localeCompare(pb, "it", { sensitivity: "base" });
    if (pc !== 0) return pc;
    const ca = profById.get(a.user_id)?.full_name || "";
    const cb = profById.get(b.user_id)?.full_name || "";
    const cc = ca.localeCompare(cb, "it", { sensitivity: "base" });
    if (cc !== 0) return cc;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const rows = [];
  let lastProject = null;
  let lastCollabWithinProject = null;

  for (const a of sorted) {
    const p = projectById.get(a.project_id);
    const c = profById.get(a.user_id);
    const projectLabel = p ? `${p.title}${p.subtitle ? ` — ${p.subtitle}` : ""}` : "(Progetto rimosso)";
    const collabLabel = c ? c.full_name : "(Collaboratore rimosso)";

    const showProject = projectLabel !== lastProject;
    if (showProject) { lastProject = projectLabel; lastCollabWithinProject = null; }

    const showCollab = collabLabel !== lastCollabWithinProject;
    if (showCollab) lastCollabWithinProject = collabLabel;

    rows.push([
      showProject ? projectLabel : "",
      `• ${formatITDateTime(new Date(a.created_at).getTime())} — ${safeText(a.text)}`,
      showCollab ? collabLabel : "",
    ]);
  }

  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title || "Report Attività", 14, 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  autoTable(doc, {
    startY: 22,
    head: [["NOME PROGETTI", "ATTIVITÀ SVOLTE", "COLLABORATORI"]],
    body: rows.length ? rows : [["", "(Nessuna attività)", ""]],
    styles: { font: "helvetica", fontSize: 9, cellPadding: 2.2, overflow: "linebreak", valign: "top" },
    headStyles: { fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 58 }, 1: { cellWidth: 92 }, 2: { cellWidth: 40 } },
    margin: { left: 14, right: 14 },
  });

  doc.save(`attivita_${new Date().toISOString().slice(0, 10)}.pdf`);
}

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);

  const [route, setRoute] = useState("home"); // home|admin|collaborator|dashboard
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [profiles, setProfiles] = useState([]);
  const [projects, setProjects] = useState([]);
  const [activities, setActivities] = useState([]);

  const [selectedCollaboratorId, setSelectedCollaboratorId] = useState("");

  const [filterProjectId, setFilterProjectId] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [filterFromDate, setFilterFromDate] = useState("");
  const [filterToDate, setFilterToDate] = useState("");

  const expanded = useRef(new Set());
  const [, force] = useState(0);

  function toggleExpanded(projectId) {
    const s = expanded.current;
    if (s.has(projectId)) s.delete(projectId); else s.add(projectId);
    force(x => x + 1);
  }
  function isExpanded(projectId) { return expanded.current.has(projectId); }

  async function refreshAll() {
    const { data: profs } = await supabase.from("profiles").select("*").order("full_name");
    setProfiles(profs || []);

    const { data: projs } = await supabase.from("projects").select("*").order("title");
    setProjects(projs || []);

    const { data: acts } = await supabase.from("activities").select("*").order("created_at", { ascending: false });
    setActivities(acts || []);
  }

  async function refreshMyProfile(userId) {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    setProfile(data || null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
      if (data.session?.user?.id) refreshMyProfile(data.session.user.id);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (sess?.user?.id) refreshMyProfile(sess.user.id);
      else setProfile(null);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user?.id) refreshAll();
  }, [session?.user?.id]);

  async function signIn() {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
  }
  async function signUp() {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) alert(error.message);
    else alert("Registrazione ok. Se richiesto, controlla email per conferma.");
  }
  async function signOut() {
    await supabase.auth.signOut();
    setRoute("home");
  }

  const isAdmin = profile?.role === "admin";

  // Admin actions
  async function adminUpdateProfile(id, patch) {
    const { error } = await supabase.from("profiles").update(patch).eq("id", id);
    if (error) alert(error.message);
    await refreshAll();
  }
  async function adminCreateProject(payload) {
    const { error } = await supabase.from("projects").insert(payload);
    if (error) alert(error.message);
    await refreshAll();
  }
  async function adminUpdateProject(id, patch) {
    const { error } = await supabase.from("projects").update(patch).eq("id", id);
    if (error) alert(error.message);
    await refreshAll();
  }
  async function adminDeleteProject(id) {
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) alert(error.message);
    await refreshAll();
  }

  // Activities
  async function addActivity(projectId, text) {
    const tx = safeText(text);
    if (!tx) return;
    const { error } = await supabase.from("activities").insert({
      project_id: projectId,
      user_id: session.user.id,
      text: tx,
    });
    if (error) alert(error.message);
    await refreshAll();
  }
  async function updateActivity(id, text) {
    const tx = safeText(text);
    if (!tx) return;
    const { error } = await supabase.from("activities").update({ text: tx }).eq("id", id);
    if (error) alert(error.message);
    await refreshAll();
  }
  async function deleteActivity(id) {
    const { error } = await supabase.from("activities").delete().eq("id", id);
    if (error) alert(error.message);
    await refreshAll();
  }

  const profileById = useMemo(() => new Map(profiles.map(p => [p.id, p])), [profiles]);
  const lastActivityByUser = useMemo(() => {
    const m = new Map();
    for (const a of activities) {
      if (!m.has(a.user_id)) m.set(a.user_id, a);
    }
    return m;
  }, [activities]);

  const activitiesFiltered = useMemo(() => {
    return activities.filter(a => {
      if (filterProjectId && a.project_id !== filterProjectId) return false;
      if (filterUserId && a.user_id !== filterUserId) return false;
      if (filterFromDate) {
        const from = parseISODate(filterFromDate);
        if (new Date(a.created_at).getTime() < from.getTime()) return false;
      }
      if (filterToDate) {
        const to = parseISODate(filterToDate);
        const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
        if (new Date(a.created_at).getTime() > end.getTime()) return false;
      }
      return true;
    });
  }, [activities, filterProjectId, filterUserId, filterFromDate, filterToDate]);

  if (!session) {
    return (
      <div className="container">
        <div className="card">
          <div className="row">
            <div>
              <h2 style={{ margin: 0 }}>Login</h2>
              <div className="small">Accedi o registrati (email + password). Poi l’admin gestisce colori/nomi/ruoli.</div>
            </div>
          </div>
          <hr />
          <div className="grid2">
            <input className="input" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
            <input className="input" placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <div className="row" style={{ marginTop: 12, justifyContent: "flex-start" }}>
            <button className="btn btnPrimary" onClick={signIn}>Accedi</button>
            <button className="btn" onClick={signUp}>Registrati</button>
          </div>
          <div className="small" style={{ marginTop: 10 }}>
            Se dopo registrazione non ti compare il profilo, controlla nelle impostazioni Auth se è richiesta conferma email.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card">
        <div className="row">
          <div>
            <h2 style={{ margin: 0 }}>Project Activity Tracker</h2>
            <div className="small">
              Utente: <b>{profile?.full_name || session.user.email}</b> · Ruolo: <b>{profile?.role || "collaborator"}</b>
            </div>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setRoute("home")}>Home</button>
            <button className="btn btnDanger" onClick={signOut}>Logout</button>
          </div>
        </div>

        <hr />

        <div className="row" style={{ justifyContent: "flex-start" }}>
          {isAdmin && <button className="btn btnPrimary" onClick={() => setRoute("admin")}>ADMIN</button>}
          <button className="btn btnPrimary" onClick={() => setRoute("collaborator")}>COLLABORATORE</button>
          <button className="btn btnPrimary" onClick={() => setRoute("dashboard")}>DASHBOARD</button>
          <span className="badge">DB: Supabase</span>
        </div>
      </div>

      <div style={{ height: 14 }} />

      {route === "home" && (
        <div className="card">
          <div className="small">
            Vai in <b>ADMIN</b> per creare progetti e gestire profili (solo se sei admin).<br/>
            I collaboratori si registrano e poi l’admin assegna colore/nome.
          </div>
        </div>
      )}

      {route === "admin" && isAdmin && (
        <AdminView
          profiles={profiles}
          projects={projects}
          onUpdateProfile={adminUpdateProfile}
          onCreateProject={adminCreateProject}
          onUpdateProject={adminUpdateProject}
          onDeleteProject={adminDeleteProject}
          onExport={() => exportActivitiesPdf({ projects, profiles, activities, title: "Attività (tutte)" })}
        />
      )}

      {route === "collaborator" && (
        <CollaboratorView
          meId={session.user.id}
          profiles={profiles}
          projects={projects}
          activities={activities}
          selectedCollaboratorId={selectedCollaboratorId}
          setSelectedCollaboratorId={setSelectedCollaboratorId}
          profileById={profileById}
          onAdd={addActivity}
          onUpdate={updateActivity}
          onDelete={deleteActivity}
          isExpanded={isExpanded}
          toggleExpanded={toggleExpanded}
        />
      )}

      {route === "dashboard" && (
        <DashboardView
          profiles={profiles}
          projects={projects}
          activities={activitiesFiltered}
          allActivities={activities}
          profileById={profileById}
          lastActivityByUser={lastActivityByUser}
          filters={{ filterProjectId, filterUserId, filterFromDate, filterToDate }}
          setFilterProjectId={setFilterProjectId}
          setFilterUserId={setFilterUserId}
          setFilterFromDate={setFilterFromDate}
          setFilterToDate={setFilterToDate}
          isExpanded={isExpanded}
          toggleExpanded={toggleExpanded}
          onExport={() => exportActivitiesPdf({
            projects, profiles, activities: allActivities,
            filters: { projectId: filterProjectId || null, userId: filterUserId || null, fromDate: filterFromDate || null, toDate: filterToDate || null },
            title: "Attività (filtrate)"
          })}
        />
      )}
    </div>
  );
}

function AdminView({ profiles, projects, onUpdateProfile, onCreateProject, onUpdateProject, onDeleteProject, onExport }) {
  const [pt, setPt] = useState("");
  const [ps, setPs] = useState("");
  const [pStart, setPStart] = useState(todayISO());
  const [pEnd, setPEnd] = useState(todayISO());

  return (
    <div className="grid2">
      <div className="card">
        <div className="row">
          <div>
            <h3 style={{ margin: 0 }}>Collaboratori (profiles)</h3>
            <div className="small">Qui assegni nome/colore/ruolo. I collaboratori compaiono dopo registrazione.</div>
          </div>
        </div>
        <hr />
        <div className="list">
          {profiles.map(p => (
            <div className="item" key={p.id}>
              <div className="row" style={{ justifyContent: "flex-start" }}>
                <span className="badge">ID: {p.id.slice(0, 6)}…</span>
                <span className="badge">Ruolo: {p.role}</span>
              </div>
              <div style={{ height: 8 }} />
              <div className="grid2">
                <input className="input" value={p.full_name} onChange={e => onUpdateProfile(p.id, { full_name: e.target.value })} />
                <input className="input" value={p.color} onChange={e => onUpdateProfile(p.id, { color: e.target.value })} />
              </div>
              <div className="row" style={{ marginTop: 10, justifyContent: "flex-start" }}>
                <button className="btn" onClick={() => onUpdateProfile(p.id, { role: "collaborator" })}>Set collaborator</button>
                <button className="btn btnPrimary" onClick={() => onUpdateProfile(p.id, { role: "admin" })}>Set admin</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="row">
          <div>
            <h3 style={{ margin: 0 }}>Progetti</h3>
            <div className="small">Crea e gestisci progetti (solo admin).</div>
          </div>
          <button className="btn btnPrimary" onClick={onExport}>Esporta PDF</button>
        </div>

        <hr />

        <div className="item">
          <div className="grid2">
            <input className="input" placeholder="Titolo progetto" value={pt} onChange={e => setPt(e.target.value)} />
            <input className="input" placeholder="Sottotitolo" value={ps} onChange={e => setPs(e.target.value)} />
          </div>
          <div style={{ height: 10 }} />
          <div className="grid2">
            <input className="input" type="date" value={pStart} onChange={e => setPStart(e.target.value)} />
            <input className="input" type="date" value={pEnd} onChange={e => setPEnd(e.target.value)} />
          </div>
          <div style={{ height: 10 }} />
          <button
            className="btn btnPrimary"
            onClick={() => {
              if (!safeText(pt)) return;
              onCreateProject({ title: safeText(pt), subtitle: safeText(ps), start_date: pStart, end_date: pEnd });
              setPt(""); setPs(""); setPStart(todayISO()); setPEnd(todayISO());
            }}
          >
            Aggiungi progetto
          </button>
        </div>

        <div style={{ height: 12 }} />
        <div className="list">
          {projects.map(p => (
            <ProjectRow key={p.id} project={p} onUpdate={onUpdateProject} onDelete={onDeleteProject} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjectRow({ project, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [t, setT] = useState(project.title);
  const [s, setS] = useState(project.subtitle || "");
  const [sd, setSd] = useState(project.start_date);
  const [ed, setEd] = useState(project.end_date);

  useEffect(() => {
    setT(project.title); setS(project.subtitle || "");
    setSd(project.start_date); setEd(project.end_date);
  }, [project]);

  return (
    <div className="item">
      <div className="row">
        <div>
          <b>{project.title}</b>
          <div className="small">{project.subtitle || ""}</div>
          <div className="small">Inizio: {project.start_date} · Fine: {project.end_date}</div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => setEditing(v => !v)}>{editing ? "Chiudi" : "Modifica"}</button>
          <button className="btn btnDanger" onClick={() => onDelete(project.id)}>Elimina</button>
        </div>
      </div>
      {editing && (
        <>
          <hr />
          <div className="grid2">
            <input className="input" value={t} onChange={e => setT(e.target.value)} />
            <input className="input" value={s} onChange={e => setS(e.target.value)} />
          </div>
          <div style={{ height: 10 }} />
          <div className="grid2">
            <input className="input" type="date" value={sd} onChange={e => setSd(e.target.value)} />
            <input className="input" type="date" value={ed} onChange={e => setEd(e.target.value)} />
          </div>
          <div style={{ height: 10 }} />
          <button className="btn btnPrimary" onClick={() => onUpdate(project.id, { title: safeText(t), subtitle: safeText(s), start_date: sd, end_date: ed })}>
            Salva
          </button>
        </>
      )}
    </div>
  );
}

function CollaboratorView({
  meId, profiles, projects, activities,
  selectedCollaboratorId, setSelectedCollaboratorId,
  profileById, onAdd, onUpdate, onDelete, isExpanded, toggleExpanded
}) {
  const options = profiles.map(p => ({ id: p.id, name: p.full_name }));
  const currentId = selectedCollaboratorId || meId;
  const me = profileById.get(meId);

  return (
    <div className="card">
      <div className="row">
        <div>
          <h3 style={{ margin: 0 }}>Collaboratore</h3>
          <div className="small">Per sicurezza, puoi modificare/eliminare solo le attività del tuo account.</div>
        </div>
        <div style={{ minWidth: 280 }}>
          <select value={currentId} onChange={e => setSelectedCollaboratorId(e.target.value)}>
            <option value={meId}>Io ({me?.full_name || "me"})</option>
            {options.filter(o => o.id !== meId).map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <div className="small">Suggerimento: lascia “Io” per lavorare.</div>
        </div>
      </div>

      <hr />

      <div className="list">
        {projects.map(p => (
          <ProjectCard
            key={p.id}
            project={p}
            activities={activities.filter(a => a.project_id === p.id && a.user_id === meId).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))}
            me={me}
            onAdd={(text)=>onAdd(p.id, text)}
            onUpdate={onUpdate}
            onDelete={onDelete}
            expanded={isExpanded(p.id)}
            onToggle={()=>toggleExpanded(p.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectCard({ project, activities, me, onAdd, onUpdate, onDelete, expanded, onToggle }) {
  const [draft, setDraft] = useState("");
  const visible = expanded ? activities : activities.slice(0, 10);

  return (
    <div className="item">
      <div className="row">
        <div>
          <b>{project.title}</b>
          <div className="small">{project.subtitle || ""}</div>
          <div className="small">Inizio: {project.start_date} · Fine: {project.end_date}</div>
        </div>
        <button className="btn" disabled={activities.length <= 10} onClick={onToggle}>
          {expanded ? "Comprimi" : `Espandi (${Math.max(0, activities.length - 10)} in più)`}
        </button>
      </div>

      <hr />

      <div className="row" style={{ justifyContent: "flex-start" }}>
        <input className="input" placeholder="Scrivi un'attività..." value={draft} onChange={e=>setDraft(e.target.value)} />
        <button className="btn btnPrimary" onClick={() => { onAdd(draft); setDraft(""); }} disabled={!safeText(draft)}>Salva</button>
      </div>

      <div style={{ height: 10 }} />
      <div className="list">
        {visible.map(a => (
          <div className="item" key={a.id}>
            <div className="small">
              <b style={{ color: me?.color || "#111" }}>{me?.full_name || "Io"}</b> · {formatITDateTime(new Date(a.created_at).getTime())}
            </div>
            <div style={{ marginTop: 6 }}>• {a.text}</div>
            <div className="row" style={{ justifyContent: "flex-start", marginTop: 10 }}>
              <InlineEdit text={a.text} onSave={(t)=>onUpdate(a.id, t)} />
              <button className="btn btnDanger" onClick={()=>onDelete(a.id)}>Elimina</button>
            </div>
          </div>
        ))}
        {activities.length === 0 && <div className="small">Nessuna attività ancora.</div>}
      </div>
    </div>
  );
}

function InlineEdit({ text, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(text);
  useEffect(()=>setVal(text),[text]);

  if (!editing) return <button className="btn" onClick={()=>setEditing(true)}>Modifica</button>;
  return (
    <>
      <input className="input" value={val} onChange={e=>setVal(e.target.value)} style={{ maxWidth: 420 }} />
      <button className="btn btnPrimary" onClick={()=>{ onSave(val); setEditing(false); }} disabled={!safeText(val)}>Salva</button>
      <button className="btn" onClick={()=>{ setVal(text); setEditing(false); }}>Annulla</button>
    </>
  );
}

function DashboardView({
  profiles, projects, activities, allActivities, profileById, lastActivityByUser,
  filters, setFilterProjectId, setFilterUserId, setFilterFromDate, setFilterToDate,
  isExpanded, toggleExpanded, onExport
}) {
  const today = new Date();

  const collabsWithStatus = useMemo(() => {
    return profiles.map(p => {
      const last = lastActivityByUser.get(p.id);
      let status = "red";
      let daysAgo = null;
      if (last) {
        daysAgo = daysBetween(new Date(last.created_at), today);
        if (daysAgo <= 7) status = "green";
        else if (daysAgo <= 10) status = "orange";
        else status = "red";
      }
      return { p, last, status, daysAgo };
    });
  }, [profiles, lastActivityByUser]);

  const activitiesByProject = useMemo(() => {
    const m = new Map();
    for (const a of activities) {
      if (!m.has(a.project_id)) m.set(a.project_id, []);
      m.get(a.project_id).push(a);
    }
    for (const [k, arr] of m.entries()) {
      arr.sort((x,y)=>new Date(y.created_at)-new Date(x.created_at));
      m.set(k, arr);
    }
    return m;
  }, [activities]);

  return (
    <div className="card">
      <div className="row">
        <div>
          <h3 style={{ margin: 0 }}>Dashboard</h3>
          <div className="small">Filtri + stato progetti + export PDF.</div>
        </div>
        <button className="btn btnPrimary" onClick={onExport}>Esporta PDF</button>
      </div>

      <hr />

      <div className="grid2">
        <div>
          <div className="small">Filtro progetto</div>
          <select value={filters.filterProjectId} onChange={e=>setFilterProjectId(e.target.value)}>
            <option value="">Tutti</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
        <div>
          <div className="small">Filtro collaboratore</div>
          <select value={filters.filterUserId} onChange={e=>setFilterUserId(e.target.value)}>
            <option value="">Tutti</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>
        <div>
          <div className="small">Da</div>
          <input className="input" type="date" value={filters.filterFromDate} onChange={e=>setFilterFromDate(e.target.value)} />
        </div>
        <div>
          <div className="small">A</div>
          <input className="input" type="date" value={filters.filterToDate} onChange={e=>setFilterToDate(e.target.value)} />
        </div>
      </div>

      <hr />

      <h4 style={{ margin: "0 0 10px 0" }}>Collaboratori · ultima attività</h4>
      <div className="list">
        {collabsWithStatus.map(({ p, last, status, daysAgo }) => {
          const col = status === "green" ? "#22c55e" : status === "orange" ? "#f59e0b" : "#ef4444";
          return (
            <div className="item" key={p.id}>
              <div className="row" style={{ justifyContent: "flex-start" }}>
                <span style={{ width: 10, height: 10, background: col, display: "inline-block", borderRadius: 3 }} />
                <b style={{ color: p.color }}>{p.full_name}</b>
                <span className="badge">{daysAgo == null ? "—" : `${daysAgo}g`}</span>
              </div>
              <div className="small" style={{ marginTop: 6 }}>
                {last ? `${formatITDateTime(new Date(last.created_at).getTime())} · ${safeText(last.text).slice(0,120)}${safeText(last.text).length>120?"…":""}` : "Nessuna attività"}
              </div>
            </div>
          );
        })}
      </div>

      <hr />

      <h4 style={{ margin: "0 0 10px 0" }}>Progetti</h4>
      <div className="list">
        {projects
          .filter(p => !filters.filterProjectId || p.id === filters.filterProjectId)
          .map(p => {
            const end = parseISODate(p.end_date);
            const ended = today.getTime() > new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23,59,59,999).getTime();
            const statusLabel = ended ? "Terminato" : "In corso";
            const statusColor = ended ? "#ef4444" : "#22c55e";

            const acts = activitiesByProject.get(p.id) || [];
            const visible = isExpanded(p.id) ? acts : acts.slice(0, 10);

            const resources = Array.from(new Set(acts.map(a => a.user_id)))
              .map(uid => profileById.get(uid)?.full_name)
              .filter(Boolean);

            return (
              <div className="item" key={p.id}>
                <div className="row">
                  <div>
                    <div className="row" style={{ justifyContent: "flex-start" }}>
                      <b>{p.title}</b>
                      <span style={{ width: 10, height: 10, background: statusColor, display: "inline-block", borderRadius: 3 }} />
                      <span className="badge">{statusLabel}</span>
                    </div>
                    <div className="small">{p.subtitle || ""}</div>
                    <div className="small">Inizio: {p.start_date} · Fine: {p.end_date}</div>
                    <div className="small" style={{ marginTop: 6 }}>
                      <b>Risorse interessate:</b> <b>{resources.length ? resources.join(", ") : "—"}</b>
                    </div>
                  </div>

                  <button className="btn" disabled={acts.length <= 10} onClick={()=>toggleExpanded(p.id)}>
                    {isExpanded(p.id) ? "Comprimi" : `Espandi (${Math.max(0, acts.length - 10)} in più)`}
                  </button>
                </div>

                <hr />

                {visible.map(a => {
                  const u = profileById.get(a.user_id);
                  return (
                    <div className="item" key={a.id}>
                      <div className="small">
                        <b style={{ color: u?.color || "#111" }}>{u?.full_name || "Utente"}</b> · {formatITDateTime(new Date(a.created_at).getTime())}
                      </div>
                      <div style={{ marginTop: 6 }}>• {a.text}</div>
                    </div>
                  );
                })}
                {acts.length === 0 && <div className="small">Nessuna attività per i filtri correnti.</div>}
              </div>
            );
          })}
      </div>
    </div>
  );
}
