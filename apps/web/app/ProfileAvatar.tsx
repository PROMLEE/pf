"use client";

import { useState } from "react";
import styles from "./ProfileAvatar.module.css";

type Props = { image?: string | null; name?: string | null };

/** Decorative photo; the surrounding account name/button supplies its label. */
export default function ProfileAvatar({ image, name }: Props) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  if (!image || failedImage === image) return <>{name?.slice(0, 1) || "P"}</>;
  return (
    // Provider CDN images are displayed directly, without an image proxy allowlist.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image}
      alt=""
      width={54}
      height={54}
      className={styles.photo}
      referrerPolicy="no-referrer"
      onError={() => setFailedImage(image)}
    />
  );
}
