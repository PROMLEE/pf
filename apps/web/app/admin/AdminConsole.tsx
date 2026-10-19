"use client";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Announcement } from "../../lib/announcements";
import styles from "./admin.module.css";
type User = {
  user_id: string;
  nickname: string;
  provider: string;
  joined_at: string;
  last_login_at: string | null;
  is_admin: boolean;
};
type Data = {
  stats: { users: number; recent_logins: number; published: number };
  users: User[];
  totalUsers: number;
  page: number;
  announcements: Announcement[];
  events: {
    id: string;
    action: string;
    actor: string;
    details: { title?: string; status?: string };
    created_at: string;
  }[];
};
const empty = {
  title: "",
  body: "",
  status: "draft" as Announcement["status"],
  important: false,
  sendPush: false,
  startsAt: "",
  endsAt: "",
};
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString("ko-KR") : "—";
const localDate = (value: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const stateLabel = (a: Announcement) =>
  a.status === "archived"
    ? "게시 종료"
    : a.status === "draft"
      ? "초안"
      : a.ends_at && Date.parse(a.ends_at) <= Date.now()
        ? "기간 종료"
        : a.starts_at && Date.parse(a.starts_at) > Date.now()
          ? "게시 예약"
          : "게시 중";
export default function AdminConsole() {
  const [data, setData] = useState<Data | null>(null),
    [tab, setTab] = useState("notices"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false);
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Announcement | null>(null),
    [form, setForm] = useState(empty),
    [open, setOpen] = useState(false),
    [editorExpanded, setEditorExpanded] = useState(true),
    [dirty, setDirty] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(
        `/api/admin?search=${encodeURIComponent(query)}&page=${page}`,
        { cache: "no-store" },
      );
      const result = await r.json();
      if (!r.ok) throw new Error(result.message);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [query, page]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const discard = () =>
    !dirty || window.confirm("저장하지 않은 공지 변경을 버릴까요?");
  function start(a: Announcement | null) {
    if (!discard()) return;
    setEditing(a);
    setForm(
      a
        ? {
            title: a.title,
            body: a.body,
            status: a.status,
            important: a.important,
            sendPush: false,
            startsAt: localDate(a.starts_at),
            endsAt: localDate(a.ends_at),
          }
        : empty,
    );
    setOpen(true);
    setEditorExpanded(true);
    setDirty(false);
    setNotice("");
  }
  function update(next: typeof form) {
    setForm(next);
    setDirty(true);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/admin/announcements", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          startsAt: form.startsAt
            ? new Date(form.startsAt).toISOString()
            : null,
          endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
          ...(editing ? { id: editing.id, revision: editing.revision } : {}),
        }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.message);
      setDirty(false);
      setOpen(false);
      setNotice(
        `공지 저장 완료 · ${result.announcement.title} · ${stateLabel(result.announcement)}`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <main className={styles.console}>
      <header className={styles.header}>
        <div>
          <Link
            href="/"
            onClick={(e) => {
              if (!discard()) e.preventDefault();
            }}
          >
            ← PortRhythm으로
          </Link>
          <h1>운영 관리</h1>
          <p>PortRhythm 사용자와 공지를 관리합니다.</p>
        </div>
        <button onClick={() => void load()} disabled={loading || saving}>
          목록 갱신
        </button>
      </header>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.success} role="status">
          {notice}
        </p>
      )}
      {data && (
        <div className={styles.stats}>
          <div>
            <span>서비스 사용자</span>
            <strong>{data.stats.users}명</strong>
          </div>
          <div>
            <span>최근 30일 로그인</span>
            <strong>{data.stats.recent_logins}명</strong>
          </div>
          <div>
            <span>게시 중인 공지</span>
            <strong>{data.stats.published}개</strong>
          </div>
        </div>
      )}
      <nav className={styles.tabs} aria-label="운영 관리 메뉴">
        {[
          ["notices", "공지 관리"],
          ["users", "사용자 조회"],
          ["events", "운영 기록"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={tab === id}
            disabled={saving}
            onClick={() => {
              if (tab !== id && discard()) {
                setTab(id);
                setOpen(false);
                setDirty(false);
              }
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {loading && !data ? (
        <p role="status">운영 정보를 불러오는 중입니다…</p>
      ) : (
        data && (
          <>
            {tab === "notices" && (
              <section>
                <div className={styles.sectionHead}>
                  <h2>
                    공지 <small>최근 100개</small>
                  </h2>
                  <button
                    className={styles.primary}
                    disabled={saving}
                    onClick={() => start(null)}
                  >
                    공지 작성
                  </button>
                </div>
                {open && (
                  <form className={styles.editor} onSubmit={save}>
                    <div className={styles.sectionHead}>
                      <div>
                        <h3>{editing ? "공지 수정" : "새 공지"}</h3>
                        <small>{dirty ? "미저장 변경 있음" : "작성 중"}</small>
                      </div>
                      <button
                        type="button"
                        disabled={saving}
                        aria-expanded={editorExpanded}
                        aria-controls="announcement-editor-fields"
                        onClick={() => setEditorExpanded((value) => !value)}
                      >
                        {editorExpanded ? "작성 영역 접기" : "작성 이어하기"}
                      </button>
                    </div>
                    <fieldset
                      id="announcement-editor-fields"
                      hidden={!editorExpanded}
                      disabled={saving || !editorExpanded}
                    >
                      <label>
                        제목
                        <input
                          required
                          maxLength={120}
                          value={form.title}
                          onChange={(e) =>
                            update({ ...form, title: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        내용
                        <textarea
                          required
                          maxLength={10000}
                          rows={7}
                          value={form.body}
                          onChange={(e) =>
                            update({ ...form, body: e.target.value })
                          }
                        />
                        <small>
                          게시한 공지는 비로그인 방문자도 읽을 수 있으며 검색엔진에
                          노출될 수 있습니다. 개인정보나 인증 정보를 넣지 마세요.
                        </small>
                      </label>
                      <div className={styles.fields}>
                        <label>
                          게시 상태
                          <select
                            value={form.status}
                            onChange={(e) =>
                              update({
                                ...form,
                                status: e.target
                                  .value as Announcement["status"],
                                sendPush:
                                  e.target.value === "published"
                                    ? form.sendPush
                                    : false,
                              })
                            }
                          >
                            <option value="draft">
                              초안 · 사용자에게 숨김
                            </option>
                            <option value="published">
                              게시 · 기간에 맞춰 표시
                            </option>
                            <option value="archived">
                              게시 종료 · 사용자에게 숨김
                            </option>
                          </select>
                        </label>
                        <label>
                          게시 시작
                          <input
                            type="datetime-local"
                            value={form.startsAt}
                            onChange={(e) =>
                              update({ ...form, startsAt: e.target.value })
                            }
                          />
                          <small>비우면 저장 즉시 게시합니다.</small>
                        </label>
                        <label>
                          게시 종료
                          <input
                            type="datetime-local"
                            value={form.endsAt}
                            onChange={(e) =>
                              update({ ...form, endsAt: e.target.value })
                            }
                          />
                          <small>
                            비우면 종료 기한이 없습니다. 현재 기기의 시간대
                            기준입니다.
                          </small>
                        </label>
                      </div>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={form.important}
                          onChange={(e) =>
                            update({ ...form, important: e.target.checked })
                          }
                        />
                        중요 공지 · 중요 표시
                      </label>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={form.sendPush}
                          disabled={
                            form.status !== "published" ||
                            !!editing?.push_requested
                          }
                          onChange={(e) =>
                            update({ ...form, sendPush: e.target.checked })
                          }
                        />
                        푸시 알림도 보내기
                      </label>
                      <small>
                        {editing?.push_requested
                          ? "이 공지는 알림을 이미 요청했습니다. 같은 공지는 한 번만 발송합니다."
                          : "게시 상태에서 선택할 수 있습니다. 예약 공지는 게시 시각 이후 발송하며, 알림을 켠 기기만 수신합니다."}
                      </small>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => {
                            if (discard()) {
                              setOpen(false);
                              setDirty(false);
                            }
                          }}
                        >
                          취소
                        </button>
                        <button
                          className={styles.primary}
                          disabled={saving || (!dirty && !!editing)}
                        >
                          {saving ? "저장 중…" : "공지 저장"}
                        </button>
                      </div>
                    </fieldset>
                  </form>
                )}
                <div className={styles.list}>
                  {data.announcements.length ? (
                    data.announcements.map((a) => (
                      <article key={a.id}>
                        <details className={styles.noticeDetails}>
                          <summary aria-label={`${a.title} 공지 내용`}>
                            <div>
                              <span className={styles.badge}>
                                {stateLabel(a)}
                              </span>
                              {a.important && (
                                <span className={styles.badge}>중요</span>
                              )}
                              <h3>{a.title}</h3>
                              <small>수정 {date(a.updated_at)}</small>
                            </div>
                            <ChevronDown size={18} aria-hidden="true" />
                          </summary>
                          <div className={styles.noticeBody}>
                            {a.push_requested && (
                              <small>
                                알림 요청됨 · 발송 성공 {a.push_sent ?? 0}건
                                {a.push_failed
                                  ? ` · 실패 ${a.push_failed}건`
                                  : ""}
                              </small>
                            )}
                            <p>{a.body}</p>
                            <small>
                              수정 {date(a.updated_at)}
                              {(a.starts_at || a.ends_at) &&
                                ` · 게시 기간 ${date(a.starts_at)} ~ ${date(a.ends_at)}`}
                            </small>
                          </div>
                        </details>
                        <button
                          disabled={saving}
                          aria-label={`${a.title} 수정`}
                          onClick={() => start(a)}
                        >
                          수정
                        </button>
                      </article>
                    ))
                  ) : (
                    <p>아직 공지가 없습니다. 초안부터 작성해 보세요.</p>
                  )}
                </div>
              </section>
            )}
            {tab === "users" && (
              <section>
                <div className={styles.sectionHead}>
                  <h2>
                    사용자 <small>{data.totalUsers}명</small>
                  </h2>
                </div>
                <p className={styles.note}>
                  PortRhythm에 등록된 계정만 표시합니다. 개인의 자산·금액은
                  조회하지 않습니다. 기존 계정의 서비스 등록 시각은 운영 화면
                  도입 시각이며, 로그인 이력은 도입 이후부터 집계합니다.
                </p>
                <form
                  className={styles.search}
                  onSubmit={(e) => {
                    e.preventDefault();
                    setPage(1);
                    setQuery(search);
                  }}
                >
                  <input
                    aria-label="닉네임 또는 사용자 ID"
                    placeholder="닉네임 또는 사용자 ID"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <button disabled={loading}>검색</button>
                </form>
                <div className={styles.list}>
                  {data.users.map((u) => (
                    <article key={u.user_id}>
                      <div>
                        <h3>
                          {u.nickname}{" "}
                          <span className={styles.badge}>
                            {u.is_admin ? "관리자" : "일반 사용자"}
                          </span>
                        </h3>
                        <p>
                          {u.provider === "NAVER"
                            ? "네이버"
                            : u.provider === "KAKAO"
                              ? "카카오"
                              : u.provider === "GUEST"
                                ? "로컬 QA"
                                : u.provider}
                        </p>
                        <small>
                          서비스 등록 {date(u.joined_at)} · 최근 로그인{" "}
                          {date(u.last_login_at)}
                        </small>
                        <small className={styles.userId}>{u.user_id}</small>
                      </div>
                    </article>
                  ))}
                  {!data.users.length && <p>일치하는 사용자가 없습니다.</p>}
                </div>
                <div className={styles.actions}>
                  <button
                    disabled={page <= 1 || loading}
                    onClick={() => setPage(page - 1)}
                  >
                    이전
                  </button>
                  <span>
                    {page} / {Math.max(1, Math.ceil(data.totalUsers / 30))}
                  </span>
                  <button
                    disabled={page * 30 >= data.totalUsers || loading}
                    onClick={() => setPage(page + 1)}
                  >
                    다음
                  </button>
                </div>
              </section>
            )}
            {tab === "events" && (
              <section>
                <h2>
                  최근 운영 기록 <small>30건</small>
                </h2>
                <div className={styles.list}>
                  {data.events.map((e) => (
                    <article key={e.id}>
                      <div>
                        <h3>{e.action}</h3>
                        <p>
                          {e.details.title ?? ""}{" "}
                          {e.details.status
                            ? `· ${e.details.status === "published" ? "게시" : e.details.status === "draft" ? "초안" : "게시 종료"}`
                            : ""}
                        </p>
                        <small>
                          {e.actor} · {date(e.created_at)}
                        </small>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )
      )}
    </main>
  );
}
