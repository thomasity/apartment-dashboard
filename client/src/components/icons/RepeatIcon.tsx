import styles from './RepeatIcon.module.css';

export function RepeatIcon({ one, size = 20 }: { one?: boolean; size?: number }) {
  return (
    <div className={styles.repeatOne}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
      </svg>
      {one && (
        <span className={styles.repeatOneBadge}>1</span>
      )}
    </div>
  );
}
