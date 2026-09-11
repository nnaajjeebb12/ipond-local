'use client';

import AlertPopup from '@/components/AlertPopup';
import { ThemeProvider } from 'next-themes';
import { ReactNode } from 'react';

export default function Providers({ children }: { children: ReactNode }) {
	return (
		<ThemeProvider
			attribute="data-theme"
			defaultTheme="dark"
			enableSystem={false}
			storageKey="theme">
			{children}
			<AlertPopup />
		</ThemeProvider>
	);
}
