"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Holding } from "./holdings";
import {
  holdingValueKrw,
  portfolioValues,
  type Portfolio,
} from "./portfolio-model";
import styles from "./portfolio3d.module.css";

type Mode = "symbol" | "bucket" | "broker";
type Item = { key: string; name: string; value: number; color: string };
type Props = { portfolio: Portfolio; holdings: Holding[] };

const won = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const amount = (value: number) => `${won.format(value)}원`;
const pct = (value: number) => `${value.toFixed(1)}%`;

function chartItems(mode: Mode, portfolio: Portfolio, holdings: Holding[]) {
  if (mode === "bucket") {
    const { values, unassigned } = portfolioValues(portfolio, holdings);
    return [
      ...portfolio.buckets.map((bucket) => ({
        key: bucket.id,
        name: bucket.name,
        value: values.get(bucket.id) ?? 0,
        color: bucket.color,
      })),
      ...(unassigned > 0
        ? [
            {
              key: "unassigned",
              name: "미분류",
              value: unassigned,
              color: "#94a4bb",
            },
          ]
        : []),
    ].filter((item) => item.value > 0);
  }
  const groups = new Map<string, Item>();
  for (const holding of holdings) {
    const key =
      mode === "broker"
        ? holding.broker
        : `${holding.market}:${holding.symbol || holding.name}`;
    const existing = groups.get(key);
    groups.set(key, {
      key,
      name: mode === "broker" ? holding.broker : holding.name,
      value:
        (existing?.value ?? 0) + holdingValueKrw(holding, portfolio.usdKrw),
      color:
        mode === "broker"
          ? ["#5378ea", "#21a99a", "#9a75df", "#dfa65c"][groups.size % 4]
          : holding.market === "KR"
            ? "#5378ea"
            : "#21a99a",
    });
  }
  const sorted = [...groups.values()]
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
  if (mode !== "symbol" || sorted.length <= 12) return sorted;
  return [
    ...sorted.slice(0, 11),
    {
      key: "other",
      name: `기타 ${sorted.length - 11}개 종목`,
      value: sorted.slice(11).reduce((sum, item) => sum + item.value, 0),
      color: "#94a4bb",
    },
  ];
}

export default function Portfolio3D({ portfolio, holdings }: Props) {
  const [mode, setMode] = useState<Mode>("bucket");
  const [selected, setSelected] = useState<string | null>(null);
  const [webgl, setWebgl] = useState(true);
  const hostRef = useRef<HTMLDivElement>(null);
  const items = useMemo(
    () => chartItems(mode, portfolio, holdings),
    [mode, portfolio, holdings],
  );
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const active = items.find((item) => item.key === selected) ?? items[0];

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !items.length) return;
    let cancelled = false;
    let cleanup = () => {};
    Promise.all([
      import("three"),
      import("three/addons/controls/OrbitControls.js"),
    ])
      .then(([THREE, { OrbitControls }]) => {
        if (cancelled) return;
        let renderer: InstanceType<typeof THREE.WebGLRenderer>;
        try {
          renderer = new THREE.WebGLRenderer({ antialias: true });
        } catch {
          setWebgl(false);
          return;
        }
        setWebgl(true);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor("#f8faff");
        renderer.domElement.setAttribute("aria-hidden", "true");
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 100);
        camera.position.set(8.5, 8.5, 12.5);
        camera.lookAt(0, 1, 0);
        scene.add(new THREE.HemisphereLight("#ffffff", "#d8e5f7", 2.2));
        const light = new THREE.DirectionalLight("#ffffff", 2.3);
        light.position.set(4, 10, 7);
        scene.add(light);
        const grid = new THREE.GridHelper(13, 13, "#dce6f4", "#e8eef7");
        grid.position.y = -0.08;
        scene.add(grid);

        const columns = Math.min(4, Math.ceil(Math.sqrt(items.length)));
        const rows = Math.ceil(items.length / columns);
        const max = Math.max(...items.map((item) => item.value));
        const bars: InstanceType<typeof THREE.Mesh>[] = [];
        const geometry = new THREE.BoxGeometry(0.86, 1, 0.86);
        const baseGeometry = new THREE.BoxGeometry(1.03, 0.1, 1.03);
        const baseMaterial = new THREE.MeshStandardMaterial({
          color: "#e5ecf6",
          roughness: 0.9,
        });
        const materials: InstanceType<typeof THREE.MeshStandardMaterial>[] = [];
        items.forEach((item, index) => {
          const x = ((index % columns) - (columns - 1) / 2) * 1.52;
          const z = (Math.floor(index / columns) - (rows - 1) / 2) * 1.52;
          const height = Math.max(0.08, (item.value / max) * 4.1);
          const material = new THREE.MeshStandardMaterial({
            color: item.color,
            roughness: 0.33,
            metalness: 0.06,
          });
          materials.push(material);
          const bar = new THREE.Mesh(geometry, material);
          bar.position.set(x, height / 2, z);
          bar.scale.y = height;
          bar.userData.key = item.key;
          scene.add(bar);
          bars.push(bar);
          const base = new THREE.Mesh(baseGeometry, baseMaterial);
          base.position.set(x, -0.02, z);
          scene.add(base);
        });

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enablePan = false;
        controls.enableZoom = true;
        controls.minDistance = 8;
        controls.maxDistance = 24;
        controls.maxPolarAngle = Math.PI / 2.08;
        controls.target.set(0, 1.2, 0);
        controls.update();
        const render = () => renderer.render(scene, camera);
        controls.addEventListener("change", render);
        const resize = () => {
          const width = Math.max(1, host.clientWidth);
          const height = Math.max(1, host.clientHeight);
          renderer.setSize(width, height);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          render();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(host);
        resize();

        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        let startX = 0;
        let startY = 0;
        const hit = (event: PointerEvent) => {
          const rect = renderer.domElement.getBoundingClientRect();
          pointer.set(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
          );
          raycaster.setFromCamera(pointer, camera);
          return raycaster.intersectObjects(bars)[0]?.object.userData.key as
            | string
            | undefined;
        };
        const onMove = (event: PointerEvent) => {
          renderer.domElement.style.cursor = hit(event) ? "pointer" : "grab";
        };
        const onDown = (event: PointerEvent) => {
          startX = event.clientX;
          startY = event.clientY;
        };
        const onUp = (event: PointerEvent) => {
          if (Math.hypot(event.clientX - startX, event.clientY - startY) > 5)
            return;
          const key = hit(event);
          if (key) setSelected(key);
        };
        renderer.domElement.addEventListener("pointermove", onMove);
        renderer.domElement.addEventListener("pointerdown", onDown);
        renderer.domElement.addEventListener("pointerup", onUp);
        cleanup = () => {
          observer.disconnect();
          controls.removeEventListener("change", render);
          controls.dispose();
          renderer.domElement.removeEventListener("pointermove", onMove);
          renderer.domElement.removeEventListener("pointerdown", onDown);
          renderer.domElement.removeEventListener("pointerup", onUp);
          geometry.dispose();
          baseGeometry.dispose();
          baseMaterial.dispose();
          materials.forEach((material) => material.dispose());
          renderer.dispose();
          renderer.domElement.remove();
        };
      })
      .catch(() => {
        if (!cancelled) setWebgl(false);
      });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [items]);

  return (
    <section className={styles.card} aria-label="3D 포트 구성">
      <div className={styles.heading}>
        <div>
          <span>PORTFOLIO MAP</span>
          <h2>포트 구성</h2>
          <p>막대를 눌러 금액을 보고, 드래그해 회전하세요.</p>
        </div>
        <div className={styles.modes} aria-label="묶음 기준">
          {(["symbol", "bucket", "broker"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={mode === option ? styles.active : ""}
              aria-pressed={mode === option}
              onClick={() => {
                setMode(option);
                setSelected(null);
              }}
            >
              {{ symbol: "종목", bucket: "포트", broker: "증권사" }[option]}
            </button>
          ))}
        </div>
      </div>
      {items.length ? (
        <div className={styles.body}>
          <div className={styles.canvasWrap}>
            <div className={styles.canvas} ref={hostRef} />
            {!webgl && (
              <p className={styles.fallback}>
                이 브라우저에서는 3D 그래프를 표시할 수 없습니다. 오른쪽
                목록에서 금액과 비중을 확인하세요.
              </p>
            )}
          </div>
          <div className={styles.details}>
            {active && (
              <div className={styles.focus}>
                <small>선택한 자산</small>
                <strong>{active.name}</strong>
                <b>{amount(active.value)}</b>
                <span>
                  전체의 {pct(total ? (active.value / total) * 100 : 0)}
                </span>
              </div>
            )}
            <div className={styles.list}>
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={active?.key === item.key ? styles.chosen : ""}
                  onClick={() => setSelected(item.key)}
                >
                  <i style={{ background: item.color }} />
                  <span title={item.name}>{item.name}</span>
                  <b>{pct(total ? (item.value / total) * 100 : 0)}</b>
                </button>
              ))}
            </div>
            {mode === "broker" && portfolio.manualAssets.length > 0 && (
              <small className={styles.note}>
                직접 입력 자산은 증권사별 분포에서 제외됩니다.
              </small>
            )}
          </div>
        </div>
      ) : (
        <p className={styles.empty}>
          가격이 있는 자산을 추가하면 3D 지도가 표시됩니다.
        </p>
      )}
    </section>
  );
}
