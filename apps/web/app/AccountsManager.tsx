"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, ArrowRight, Wallet } from "lucide-react";
import type { Holding, Market } from "./holdings";
import {
  accountValuation,
  purchaseTotal,
  type BrokerageAccount,
} from "./accounts-model";
import AssetIcon from "./AssetIcon";
import NumberInput from "./NumberInput";
import styles from "./AccountsManager.module.css";

type Instrument = {
  market: Market;
  symbol: string;
  name: string;
  exchange: string | null;
};
async function response<T>(res: Response): Promise<T> {
  const result = await res.json();
  if (!res.ok) throw new Error(result.message || "처리하지 못했습니다");
  return result;
}
const amount = (value: number | null, currency: Market) =>
  value === null
    ? "—"
    : `${currency === "US" ? "$" : ""}${value.toLocaleString("ko-KR", { maximumFractionDigits: currency === "US" ? 4 : 0 })}${currency === "KR" ? "원" : ""}`;

export default function AccountsManager({
  userId,
  holdings,
  onHoldings,
  onNotice,
  onDirty,
  onOpenAsset,
  onRefreshQuotes,
}: {
  userId: string;
  holdings: Holding[];
  onHoldings: (rows: Holding[]) => void;
  onNotice: (text: string) => void;
  onDirty: (dirty: boolean) => void;
  onOpenAsset: (row: Holding) => void;
  onRefreshQuotes: () => void;
}) {
  const accountStorageKey = `pf-selected-account:${userId}`;
  const [accounts, setAccounts] = useState<BrokerageAccount[]>([]),
    [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false),
    [newBroker, setNewBroker] = useState(""),
    [newName, setNewName] = useState("");
  const [broker, setBroker] = useState(""),
    [name, setName] = useState("");
  const [formOpen, setFormOpen] = useState(false),
    [editingId, setEditingId] = useState<string | null>(null);
  const [market, setMarket] = useState<Market>("KR"),
    [query, setQuery] = useState(""),
    [matches, setMatches] = useState<Instrument[]>([]),
    [instrument, setInstrument] = useState<Instrument | null>(null);
  const [searching, setSearching] = useState(false),
    [quantity, setQuantity] = useState(""),
    [cost, setCost] = useState("");
  const [pendingMove, setPendingMove] = useState<{
    holdingId: string;
    targetId: string;
  } | null>(null);
  const selected = accounts.find((a) => a.id === selectedId);
  const rows = holdings.filter(
    (row) =>
      row.accountId === selectedId ||
      (!row.accountId &&
        row.broker === selected?.broker &&
        row.account === selected?.name),
  );
  const accountDirty = Boolean(
    selected && (broker !== selected.broker || name !== selected.name),
  );
  const editingRow = holdings.find((row) => row.id === editingId);
  const stockDirty = Boolean(
    formOpen &&
      (editingRow
        ? quantity !== String(editingRow.quantity) ||
          cost !==
            (editingRow.averageCost === null
              ? ""
              : String(editingRow.averageCost))
        : instrument || query || quantity || cost),
  );
  const createDirty = Boolean(creating && (newBroker || newName));
  const inputDirty = accountDirty || stockDirty || createDirty;
  const dirty = inputDirty || Boolean(pendingMove);
  const valuation = accountValuation(rows);
  const totalCost = purchaseTotal(quantity, cost);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    setBroker(selected?.broker ?? "");
    setName(selected?.name ?? "");
  }, [selected?.id, selected?.broker, selected?.name]);
  useEffect(() => {
    const controller = new AbortController();
    fetchResult()
      .then((res) => response<{ accounts: BrokerageAccount[] }>(res))
      .then((result) => {
        if (controller.signal.aborted) return;
        setAccounts(result.accounts);
        let saved = "";
        try {
          saved = sessionStorage.getItem(accountStorageKey) ?? "";
        } catch {
          /* Preferences are optional. */
        }
        setSelectedId(
          result.accounts.find((account) => account.id === saved)?.id ??
            result.accounts[0]?.id ??
            "",
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    async function fetchResult() {
      return fetch("/api/accounts", {
        signal: controller.signal,
        cache: "no-store",
      });
    }
    return () => controller.abort();
  }, [accountStorageKey]);
  useEffect(() => {
    if (selectedId) {
      try {
        sessionStorage.setItem(accountStorageKey, selectedId);
      } catch {
        /* Preferences are optional. */
      }
    }
  }, [accountStorageKey, selectedId]);
  function resetStock() {
    setPendingMove(null);
    setFormOpen(false);
    setEditingId(null);
    setInstrument(null);
    setQuery("");
    setMatches([]);
    setQuantity("");
    setCost("");
    setError("");
  }
  function selectAccount(id: string) {
    if (
      busy ||
      (dirty &&
        !window.confirm("저장하지 않은 입력을 버리고 계좌를 변경할까요?"))
    )
      return;
    resetStock();
    setCreating(false);
    setNewBroker("");
    setNewName("");
    setSelectedId(id);
  }
  async function saveAccount(create: boolean) {
    setBusy(true);
    setError("");
    try {
      const result = await response<{
        accounts: BrokerageAccount[];
        account?: BrokerageAccount;
        holdings?: Holding[];
      }>(
        await fetch("/api/accounts", {
          method: create ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            create
              ? { broker: newBroker, name: newName }
              : { id: selectedId, broker, name },
          ),
        }),
      );
      setAccounts(result.accounts);
      if (result.holdings) onHoldings(result.holdings);
      if (create) {
        setSelectedId(result.account!.id);
        setCreating(false);
        setNewBroker("");
        setNewName("");
      }
      onNotice(
        `${create ? "계좌 추가" : "계좌 정보 저장"} 완료 · ${create ? newName.trim() : name.trim()}`,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "계좌 저장 실패");
    } finally {
      setBusy(false);
    }
  }
  async function search() {
    if (!query.trim() || searching) return;
    setSearching(true);
    setError("");
    setInstrument(null);
    try {
      const result = await response<{ instruments: Instrument[] }>(
        await fetch(
          `/api/instruments?market=${market}&query=${encodeURIComponent(query.trim())}`,
        ),
      );
      setMatches(result.instruments);
      if (!result.instruments.length)
        setError("검색 결과가 없습니다. 종목명 또는 코드를 확인해 주세요.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "종목 검색 실패");
    } finally {
      setSearching(false);
    }
  }
  async function saveStock() {
    if (!selected || !instrument) return;
    const shares = Number(quantity),
      average = cost.trim() === "" ? null : Number(cost);
    if (
      !Number.isFinite(shares) ||
      shares <= 0 ||
      shares >= 1e12 ||
      Math.abs(shares - Math.round(shares * 1e6) / 1e6) > 1e-9 ||
      (average !== null &&
        (!Number.isFinite(average) || average <= 0 || average >= 1e12))
    ) {
      setError(
        "수량은 양수·소수점 6자리까지, 매입단가는 양수로 입력해 주세요.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await response<{ holdings: Holding[] }>(
        await fetch("/api/holdings", {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            editingId
              ? { id: editingId, quantity: shares, averageCost: average }
              : {
                  insertOnly: true,
                  holdings: [
                    {
                      ...instrument,
                      accountId: selected.id,
                      broker: selected.broker,
                      account: selected.name,
                      quantity: shares,
                      averageCost: average,
                      capturedPrice: null,
                      capturedAt: new Date().toISOString(),
                    },
                  ],
                },
          ),
        }),
      );
      onHoldings(result.holdings);
      resetStock();
      onNotice(
        `${selected.name} · ${instrument.name} ${editingId ? "수정" : "추가"} 완료`,
      );
      if (!editingId) onRefreshQuotes();
    } catch (error) {
      setError(error instanceof Error ? error.message : "종목 저장 실패");
    } finally {
      setBusy(false);
    }
  }
  function editStock(row: Holding) {
    if (
      dirty &&
      !window.confirm("저장하지 않은 입력을 버리고 이 종목을 수정할까요?")
    )
      return;
    setPendingMove(null);
    setCreating(false);
    setNewBroker("");
    setNewName("");
    setBroker(selected?.broker ?? "");
    setName(selected?.name ?? "");
    setEditingId(row.id);
    setInstrument({
      market: row.market,
      name: row.name,
      symbol: row.symbol,
      exchange: row.exchange ?? null,
    });
    setQuantity(String(row.quantity));
    setCost(row.averageCost === null ? "" : String(row.averageCost));
    setMatches([]);
    setFormOpen(true);
    setError("");
  }
  async function move(row: Holding, id: string) {
    if (busy || inputDirty || !id || id === (row.accountId ?? selectedId))
      return;
    setBusy(true);
    setError("");
    try {
      const result = await response<{ holdings: Holding[] }>(
        await fetch("/api/holdings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: row.id, accountId: id }),
        }),
      );
      onHoldings(result.holdings);
      setPendingMove(null);
      onNotice(
        `${row.name} · ${accounts.find((a) => a.id === id)?.name} 계좌 이동 완료`,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "계좌 이동 실패");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.manager} aria-label="증권 계좌 관리">
      <header className={styles.header}>
        <div>
          <h1>계좌 관리</h1>
          <p>증권사·계좌명과 계좌별 주식·ETF를 직접 관리하세요.</p>
        </div>
        <button disabled={busy || dirty} onClick={() => setCreating(!creating)}>
          <Plus size={16} />
          계좌 추가
        </button>
      </header>
      <datalist id="pf-brokers">
        {[
          "미래에셋증권",
          "메리츠증권",
          "한국투자증권",
          "삼성증권",
          "NH투자증권",
          "KB증권",
          "키움증권",
          "토스증권",
        ].map((value) => (
          <option value={value} key={value} />
        ))}
      </datalist>
      {creating && (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void saveAccount(true);
          }}
        >
          <h2>새 계좌</h2>
          <small>
            앱에서 관리할 계좌를 등록합니다. 실제 증권 계좌 개설이나 잔고 자동
            연결은 아닙니다.
          </small>
          <label>
            증권사
            <input
              list="pf-brokers"
              disabled={busy}
              value={newBroker}
              onChange={(event) => setNewBroker(event.target.value)}
              required
              maxLength={80}
              placeholder="증권사 입력 또는 선택"
            />
          </label>
          <label>
            계좌명 · 별칭
            <input
              value={newName}
              disabled={busy}
              onChange={(event) => setNewName(event.target.value)}
              required
              maxLength={120}
              placeholder="예: 연금저축, ISA, 해외주식"
            />
          </label>
          <div className={styles.actions}>
            <button disabled={busy} type="submit">
              {busy ? "저장 중" : "계좌 만들기"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setCreating(false);
                setNewBroker("");
                setNewName("");
              }}
            >
              취소
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">계좌를 불러오는 중입니다.</p>
      ) : (
        <div className={styles.layout}>
          <aside className={styles.accountList}>
            <h2>
              내 계좌 <span>{accounts.length}</span>
            </h2>
            {accounts.map((account) => (
              <button
                key={account.id}
                disabled={busy}
                aria-pressed={selectedId === account.id}
                onClick={() => selectAccount(account.id)}
              >
                <Wallet size={18} />
                <span>
                  <strong>{account.name}</strong>
                  <small>{account.broker}</small>
                </span>
                <span>
                  {
                    holdings.filter((row) => row.accountId === account.id)
                      .length
                  }
                  종목
                </span>
              </button>
            ))}
          </aside>
          <div className={styles.mobileSelect}>
            {accounts.length > 0 && (
              <label>
                계좌 선택
                <select
                  value={selectedId}
                  disabled={busy}
                  onChange={(event) => selectAccount(event.target.value)}
                >
                  {accounts.map((account) => (
                    <option value={account.id} key={account.id}>
                      {account.broker} · {account.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {selected ? (
            <section className={styles.details}>
              <div className={styles.accountHead}>
                <div>
                  <small>{selected.broker}</small>
                  <h2>{selected.name}</h2>
                </div>
                <span>{rows.length}종목</span>
              </div>
              <div
                className={styles.valuation}
                aria-label="계좌 주식 ETF 평가액"
              >
                <span>주식·ETF 평가액</span>
                <strong>
                  {valuation.KR.count > 0
                    ? `${amount(valuation.KR.priced ? valuation.KR.value : null, "KR")}${valuation.US.count > 0 ? " · " : ""}`
                    : ""}
                  {valuation.US.count > 0
                    ? amount(
                        valuation.US.priced ? valuation.US.value : null,
                        "US",
                      )
                    : ""}
                  {rows.length === 0 ? "—" : ""}
                </strong>
                <small>
                  원화·달러 각각 합산 · 현금·코인 제외 · 환율 환산 전
                </small>
                <small>
                  {valuation.unpriced > 0
                    ? `가격 미확인 ${valuation.unpriced}종목 제외 · `
                    : ""}
                  {valuation.captured > 0
                    ? `캡처 가격 ${valuation.captured}종목 포함 · `
                    : ""}
                  {valuation.oldestCheckedAt
                    ? `가장 오래된 시세 확인 · ${new Date(valuation.oldestCheckedAt).toLocaleString("ko-KR")}`
                    : "조회 시세 없음"}
                </small>
              </div>
              <details className={styles.metadata}>
                <summary>계좌 정보 수정</summary>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveAccount(false);
                  }}
                  className={styles.form}
                >
                  <label>
                    증권사
                    <input
                      list="pf-brokers"
                      value={broker}
                      onChange={(event) => setBroker(event.target.value)}
                      required
                      maxLength={80}
                      disabled={busy}
                    />
                  </label>
                  <label>
                    계좌명 · 별칭
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required
                      maxLength={120}
                      disabled={busy}
                    />
                  </label>
                  <small>
                    이 계좌의 {rows.length}개 종목에 적용
                    {accountDirty ? " · 계좌 정보 미저장" : ""}
                  </small>
                  <div className={styles.actions}>
                    <button
                      type="submit"
                      disabled={
                        busy ||
                        Boolean(pendingMove) ||
                        (broker === selected.broker && name === selected.name)
                      }
                    >
                      {busy ? "저장 중" : "계좌 정보 저장"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setBroker(selected.broker);
                        setName(selected.name);
                      }}
                    >
                      입력 취소
                    </button>
                  </div>
                  <small>
                    증권사·계좌명 변경은 이 계좌의 모든 보유 종목에 함께
                    반영됩니다.
                  </small>
                </form>
              </details>
              <div className={styles.stockHead}>
                <h3>보유 종목</h3>
                <button
                  disabled={busy || dirty}
                  onClick={() => {
                    resetStock();
                    setFormOpen(true);
                  }}
                >
                  <Plus size={16} />
                  종목 직접 추가
                </button>
              </div>
              {formOpen && (
                <form
                  className={styles.form}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveStock();
                  }}
                >
                  <h3>{editingId ? "보유 종목 수정" : "종목 추가"}</h3>
                  {!editingId && (
                    <>
                      <label>
                        시장
                        <select
                          value={market}
                          disabled={busy || searching}
                          onChange={(event) => {
                            setMarket(event.target.value as Market);
                            setMatches([]);
                            setInstrument(null);
                          }}
                        >
                          <option value="KR">국내 주식·ETF</option>
                          <option value="US">미국 주식·ETF</option>
                        </select>
                      </label>
                      <label>
                        종목명 또는 코드
                        <div className={styles.search}>
                          <input
                            value={query}
                            aria-label="종목명 또는 코드"
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void search();
                              }
                            }}
                            disabled={busy || searching}
                            onChange={(event) => {
                              setQuery(event.target.value);
                              setMatches([]);
                              setInstrument(null);
                            }}
                            maxLength={80}
                            placeholder="삼성전자, 005930, AAPL"
                          />
                          <button
                            type="button"
                            disabled={searching || busy || !query.trim()}
                            onClick={() => void search()}
                          >
                            {searching ? "검색 중" : "검색"}
                          </button>
                        </div>
                      </label>
                      {matches.length > 0 && (
                        <div className={styles.matches}>
                          {matches.map((item) => (
                            <button
                              type="button"
                              key={`${item.market}:${item.symbol}:${item.exchange}`}
                              onClick={() => {
                                setInstrument(item);
                                setMatches([]);
                              }}
                            >
                              <strong>{item.name}</strong>
                              <small>
                                {item.symbol} · {item.exchange}
                              </small>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {instrument && (
                    <p className={styles.selected}>
                      {instrument.name}{" "}
                      <span>
                        {instrument.symbol} · {instrument.exchange}
                      </span>
                    </p>
                  )}
                  <div className={styles.numbers}>
                    <label>
                      현재 총보유 수량 · 주
                      <NumberInput
                        value={quantity}
                        onValueChange={setQuantity}
                        min="0.000001"
                        max="999999999999"
                        step="0.000001"
                        required
                        disabled={busy}
                      />
                    </label>
                    <label>
                      주당 평균 매입단가 ·{" "}
                      {(instrument?.market ?? market) === "US" ? "USD" : "원"}
                      <NumberInput
                        value={cost}
                        onValueChange={setCost}
                        min="0"
                        step="any"
                        placeholder="모르면 비워두세요"
                        disabled={busy}
                      />
                    </label>
                  </div>
                  <small>
                    이번 거래 수량이 아니라, 거래 후 현재 보유한 전체 수량을
                    입력하세요.
                  </small>
                  <p className={styles.verification} role="status">
                    총매입금액 검산{" "}
                    <strong>
                      {totalCost === null
                        ? "수량과 평균 단가를 입력하면 표시됩니다"
                        : amount(totalCost, instrument?.market ?? market)}
                    </strong>
                    <small>
                      총보유 수량 × 주당 평균 매입단가 · 수수료 별도
                    </small>
                  </p>
                  <small>
                    종목명·코드는 한국투자증권 종목 마스터로 확인합니다.
                    현재가는 저장 후 조회합니다.
                  </small>
                  <div className={styles.actions}>
                    <button type="submit" disabled={busy || !instrument}>
                      {busy
                        ? "저장 중"
                        : editingId
                          ? "종목 수정 저장"
                          : "이 계좌에 추가"}
                    </button>
                    <button type="button" disabled={busy} onClick={resetStock}>
                      취소
                    </button>
                  </div>
                </form>
              )}
              {rows.length === 0 ? (
                <div className={styles.empty}>
                  <Wallet size={28} />
                  <h3>등록된 종목이 없습니다</h3>
                  <p>종목을 검색해 수량과 평균 매입단가를 입력하세요.</p>
                </div>
              ) : (
                <div className={styles.stocks}>
                  {rows.map((row) => (
                    <article key={row.id}>
                      <div className={styles.stockIdentity}>
                        <AssetIcon
                          kind="stock"
                          name={row.name}
                          symbol={row.symbol}
                          market={row.market}
                          exchange={row.exchange}
                        />
                        <button
                          onClick={() => onOpenAsset(row)}
                          disabled={busy}
                        >
                          <strong>{row.name}</strong>
                          <small>
                            {row.market === "KR" ? "국내" : "미국"} ·{" "}
                            {row.symbol}
                            <ArrowRight size={12} />
                          </small>
                        </button>
                      </div>
                      <div className={styles.facts}>
                        <div>
                          <small>보유 수량</small>
                          <strong>
                            {row.quantity.toLocaleString("ko-KR", {
                              maximumFractionDigits: 6,
                            })}
                            주
                          </strong>
                        </div>
                        <div>
                          <small>주당 평균 매입단가</small>
                          <strong>{amount(row.averageCost, row.market)}</strong>
                        </div>
                      </div>
                      <div className={styles.rowActions}>
                        <button disabled={busy} onClick={() => editStock(row)}>
                          <Pencil size={14} />
                          수정
                        </button>
                        <label className={styles.move}>
                          계좌 이동
                          <select
                            aria-label={`${row.name} 보유 계좌`}
                            value={
                              pendingMove?.holdingId === row.id
                                ? pendingMove.targetId
                                : ""
                            }
                            disabled={
                              busy ||
                              formOpen ||
                              inputDirty ||
                              Boolean(
                                pendingMove && pendingMove.holdingId !== row.id,
                              )
                            }
                            onChange={(event) =>
                              setPendingMove(
                                event.target.value
                                  ? {
                                      holdingId: row.id,
                                      targetId: event.target.value,
                                    }
                                  : null,
                              )
                            }
                          >
                            <option value="">이동할 계좌 선택</option>
                            {accounts
                              .filter(
                                (account) =>
                                  account.id !== (row.accountId ?? selectedId),
                              )
                              .map((account) => (
                                <option key={account.id} value={account.id}>
                                  {account.broker} · {account.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      </div>
                      {pendingMove?.holdingId === row.id && (
                        <div
                          className={styles.moveReview}
                          role="region"
                          aria-label={`${row.name} 계좌 이동 확인`}
                        >
                          <strong>
                            {row.name} ·{" "}
                            {row.quantity.toLocaleString("ko-KR", {
                              maximumFractionDigits: 6,
                            })}
                            주
                          </strong>
                          <p>
                            {selected.broker} · {selected.name}
                            <br />→{" "}
                            {
                              accounts.find(
                                (a) => a.id === pendingMove.targetId,
                              )?.broker
                            }{" "}
                            ·{" "}
                            {
                              accounts.find(
                                (a) => a.id === pendingMove.targetId,
                              )?.name
                            }
                          </p>
                          <small>
                            앱의 등록 계좌만 변경합니다. 실제 증권사 이체는
                            아닙니다. 수량·매입단가·포트 배정은 유지됩니다.
                          </small>
                          <div className={styles.actions}>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void move(row, pendingMove.targetId)
                              }
                            >
                              {busy ? "이동 중" : "확인 후 이동"}
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => setPendingMove(null)}
                            >
                              취소
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <div className={styles.empty}>
              <Wallet size={28} />
              <h2>첫 계좌를 만들어 보세요</h2>
              <p>캡처 없이도 계좌와 보유 종목을 직접 등록할 수 있습니다.</p>
              <button onClick={() => setCreating(true)}>계좌 추가</button>
            </div>
          )}
        </div>
      )}
      {dirty && (
        <p className={styles.status} role="status">
          미저장 ·{" "}
          {[
            createDirty && "새 계좌 입력",
            accountDirty && "계좌 정보 변경",
            stockDirty && (editingId ? "보유 종목 수정" : "종목 추가 입력"),
            pendingMove && "계좌 이동 확인",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </section>
  );
}
