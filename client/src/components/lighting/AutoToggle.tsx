import styles from './AutoToggle.module.css';

interface Props {
  on: boolean;
  onClick: () => void;
}

export default function AutoToggle({ on, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`${styles.toggle} ${
        on
          ? styles.on
          : styles.off
      }`}
    >
      {on && <span className={styles.dot} />}
      Auto
    </button>
  );
}
