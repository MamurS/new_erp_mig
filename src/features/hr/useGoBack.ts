import { useNavigate } from 'react-router-dom';

/** «Назад» / «Отмена»: returns to the previous screen (keeping its filters) or to `fallback`. */
export function useGoBack(fallback: string) {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback);
  };
}
