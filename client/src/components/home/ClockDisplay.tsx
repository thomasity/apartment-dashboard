import styles from './ClockDisplay.module.css';

interface Props {
  hour: string;
  m: string;
  s: string;
  ampm: string;
  dateStr: string;
}

export default function ClockDisplay({ hour, m, s, ampm, dateStr }: Props) {
  return (
    <div className={styles.root}>
      <div className={styles.timeRow}>
        <span
          className={styles.time}
        >
          {hour}:{m}
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
            :{s}
          </span>
        </div>
      </div>
      <div
        className={styles.date}
      >
        {dateStr}
      </div>
    </div>
  );
}
