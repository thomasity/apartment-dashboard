import styles from './PlayingBars.module.css';

export default function PlayingBars() {
  return (
    <span className={styles.root}>
      {[0, 150, 75].map((delay, i) => (
        <span
          key={i}
          className={styles.bar}
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
