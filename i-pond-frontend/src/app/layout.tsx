import LicenseExpired from '@/components/LicenseExpired';
import Providers from '@/components/Providers';
import { getLicenseInfo } from '@/lib/license';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

// The license gate must run per request, never be frozen into a static prerender.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
	title: 'See ME - Aquaculture Monitoring',
	description: 'Real-time aquaculture monitoring system for pond management',
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	// Server-side gate: an invalid license never renders the app tree at all.
	const license = getLicenseInfo();

	return (
		<html lang="en" suppressHydrationWarning>
			<body className={inter.className}>
				{license.valid ? (
					<Providers>{children}</Providers>
				) : (
					<LicenseExpired info={license} />
				)}
			</body>
		</html>
	);
}
