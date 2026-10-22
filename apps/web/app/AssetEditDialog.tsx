"use client";
import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { Portfolio } from "./portfolio-model";
import type { BrokerageAccount } from "./accounts-model";
import NumberInput from "./NumberInput";
import AssetIcon from "./AssetIcon";
import { validFx } from "./fx-gains";
import styles from "./AssetEditDialog.module.css";
export type EditableAssetSelection = { kind: "manual" | "crypto"; id: string };
export default function AssetEditDialog({
  selection,
  portfolio,
  accounts,
  onSave,
  onClose,
  onDirty,
}: {
  selection: EditableAssetSelection;
  portfolio: Portfolio;
  accounts: BrokerageAccount[];
  onSave: (next: Portfolio) => Promise<void>;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const manual =
    selection.kind === "manual"
      ? portfolio.manualAssets.find((a) => a.id === selection.id)
      : undefined;
  const crypto =
    selection.kind === "crypto"
      ? portfolio.cryptoAssets.find((a) => `crypto:${a.id}` === selection.id)
      : undefined;
  const asset = manual ?? crypto;
  const [name, setName] = useState(asset?.name ?? "");
  const [amount, setAmount] = useState(
    String(
      manual ? (manual.valueUsd ?? manual.valueKrw) : (crypto?.quantity ?? ""),
    ),
  );
  const [basis, setBasis] = useState(
    String(manual?.averageFxRate ?? crypto?.averageCostKrw ?? ""),
  );
  const [bucketId, setBucketId] = useState(asset?.bucketId ?? "");
  const [accountId, setAccountId] = useState(manual?.accountId ?? "");
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const dirty =
    name !== asset?.name ||
    amount !==
      String(
        manual
          ? (manual.valueUsd ?? manual.valueKrw)
          : (crypto?.quantity ?? ""),
      ) ||
    basis !== String(manual?.averageFxRate ?? crypto?.averageCostKrw ?? "") ||
    bucketId !== (asset?.bucketId ?? "") ||
    accountId !== (manual?.accountId ?? "");
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  useEffect(() => {
    onDirty(dirty || saving);
    return () => onDirty(false);
  }, [dirty, saving, onDirty]);
  const readOnly = !!manual?.readOnly;
  function close() {
    if (
      saving ||
      (dirty && !window.confirm("저장하지 않은 변경 사항을 버리고 닫을까요?"))
    )
      return;
    onClose();
  }
  async function save(remove = false) {
    if (!asset || readOnly || saving) return;
    const value = Number(amount),
      cost = basis === "" ? null : Number(basis);
    if (
      !remove &&
      (!name.trim() ||
        !amount.trim() ||
        !Number.isFinite(value) ||
        value < 0 ||
        value >= 1e15 ||
        (cost !== null &&
          (!Number.isFinite(cost) || (manual ? !validFx(cost) : cost <= 0))))
    ) {
      setError("이름과 0 이상의 금액·수량, 올바른 매입단가를 입력해 주세요.");
      return;
    }
    if (remove && !window.confirm(`${asset.name}을 등록 자산에서 삭제할까요?`))
      return;
    setSaving(true);
    setError("");
    try {
      await onSave({
        ...portfolio,
        manualAssets: portfolio.manualAssets
          .filter((a) => !(remove && a.id === manual?.id))
          .map((a) =>
            a.id === manual?.id
              ? {
                  ...a,
                  name: name.trim(),
                  valueKrw:
                    a.valueUsd === null ? value : value * portfolio.usdKrw,
                  valueUsd: a.valueUsd === null ? null : value,
                  averageFxRate: a.valueUsd === null ? null : cost,
                  bucketId: bucketId || null,
                  accountId: accountId || null,
                }
              : a,
          ),
        cryptoAssets: portfolio.cryptoAssets
          .filter((a) => !(remove && a.id === crypto?.id))
          .map((a) =>
            a.id === crypto?.id
              ? {
                  ...a,
                  quantity: value,
                  averageCostKrw: cost,
                  bucketId: bucketId || null,
                }
              : a,
          ),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="asset-edit-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <header className={styles.header}>
          <AssetIcon
            kind={manual ? "cash" : "crypto"}
            symbol={
              crypto?.marketCode ?? (manual?.valueUsd === null ? "KRW" : "USD")
            }
            name={asset?.name ?? "자산"}
          />
          <div>
            <small>{manual ? "현금·기타" : "가상자산"}</small>
            <h2 id="asset-edit-title">
              {asset?.name ?? "자산을 찾지 못했습니다"}
            </h2>
          </div>
        </header>
        {readOnly ? (
          <p>메리츠 연동 자산입니다. 동기화 버튼으로 잔고를 반영해 주세요.</p>
        ) : (
          asset && (
            <fieldset className={styles.fields} disabled={saving}>
              {manual && (
                <label>
                  자산 이름
                  <input
                    value={name}
                    maxLength={100}
                    required
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              )}
              <label>
                {manual
                  ? `보유 금액 · ${manual.valueUsd === null ? "KRW" : "USD"}`
                  : "총보유 수량 · 개"}
                <NumberInput
                  value={amount}
                  onValueChange={setAmount}
                  min="0"
                  max="999999999999999"
                  step="any"
                  required
                />
              </label>
              {(crypto || manual?.valueUsd !== null) && (
                <label>
                  {crypto
                    ? "개당 평균 매입단가 · KRW"
                    : "평균 환전 단가 · 1 USD당 원"}
                  <NumberInput
                    value={basis}
                    onValueChange={setBasis}
                    min={crypto ? "0" : "100"}
                    max={crypto ? "999999999999" : "100000"}
                    step="any"
                    placeholder="모르면 비워두세요"
                  />
                </label>
              )}
              {manual?.valueUsd != null && (
                <p className={styles.hint}>
                  원화 환산{" "}
                  {(Number(amount || 0) * portfolio.usdKrw).toLocaleString(
                    "ko-KR",
                    { maximumFractionDigits: 0 },
                  )}
                  원
                </p>
              )}
              <label>
                포트 배정
                <select
                  value={bucketId}
                  onChange={(e) => setBucketId(e.target.value)}
                >
                  <option value="">미분류</option>
                  {portfolio.buckets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              {manual && (
                <label>
                  연결 계좌
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                  >
                    <option value="">계좌 미연결</option>
                    {accounts
                      .filter((a) => !a.readOnly)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.broker} · {a.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </fieldset>
          )
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <footer className={styles.footer}>
          {asset && !readOnly && (
            <button
              type="button"
              className={styles.remove}
              disabled={saving}
              onClick={() => void save(true)}
              aria-label={`${asset.name} 삭제`}
            >
              <Trash2 size={17} /> 삭제
            </button>
          )}
          <button type="button" disabled={saving} onClick={close}>
            {readOnly ? "닫기" : "취소"}
          </button>
          {asset && !readOnly && (
            <button
              type="submit"
              className={styles.save}
              disabled={saving || !dirty}
            >
              {saving ? "저장 중…" : "저장"}
            </button>
          )}
        </footer>
      </form>
    </dialog>
  );
}
