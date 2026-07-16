import { redirect } from 'next/navigation';

// The standalone home page was removed; send visitors straight to Search.
export default function HomePage() {
  redirect('/search');
}
