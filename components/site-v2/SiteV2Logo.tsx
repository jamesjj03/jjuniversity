import styles from "./SiteV2.module.css";
import geometry from "@/public/branding/jju/logo-geometry.json";

export default function SiteV2Logo({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`${styles.logoMark} ${className}`.trim()}
      viewBox={geometry.viewBox}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="currentColor">
        <path d={geometry.u.path} />
        {geometry.js.map((letter) => (
          <path key={letter.path} d={letter.path} />
        ))}
      </g>
    </svg>
  );
}
