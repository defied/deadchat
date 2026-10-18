import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui';

export function NotFoundPage() {
  return (
    <div className="page">
      <EmptyState
        title="Page not found"
        action={
          <Link className="btn btn-primary" to="/chat">
            Go to Chat
          </Link>
        }
      >
        That address doesn&apos;t exist in DeadChat.
      </EmptyState>
    </div>
  );
}
