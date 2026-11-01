import { useClock } from '../../hooks/useClock';
import styles from './ClockDisplay.module.css';

export default function ClockDisplay() {
  const { hour, minute, second, ampm, longDate } = useClock();

  return (
    <div className={styles.root}>
      <div className={styles.timeRow}>
        <span
          className={styles.time}
        >
          {hour}:{minute}
        </span>
        <div className={styles.side}>
          <span
            className={styles.ampm}
          >
            {ampm}
          </span>
          <span
            className={styles.seconds}
          >
            :{second}
          </span>
        </div>
      </div>
      <div
        className={styles.date}
      >
        {longDate}
      </div>
    </div>
  );
}
