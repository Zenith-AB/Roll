import { useReadingProgress } from '../hooks/useReadingProgress';

export default function ReadingProgress() {
  const progress = useReadingProgress();
  if (progress <= 0) return null;
  return <div className="reading-progress" style={{ width: `${progress}%` }} />;
}
