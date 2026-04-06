import { MultiplicationGame } from "@/components/MultiplicationGame";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <MultiplicationGame />
    </div>
  );
}
