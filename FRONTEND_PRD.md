# i-Pond Frontend - PRD: Migration to Next.js

## Project Overview

Client-side website for i-Pond aquaculture monitoring. Migrate the existing Quasar Vue.js frontend to Next.js with improved performance, SEO, and modern development practices.

## Scope

- Convert all Vue components to React components
- Maintain all existing features and user flows
- Implement server-side rendering where beneficial
- Improve performance and bundle size
- Modern UI framework integration (TailwindCSS or Material-UI)

## Key Features

1. **Dashboard Pages**
   - Main dashboard with sensor data visualization (all ponds overview)
   - Individual pond dashboards (10+ ponds supported)
   - Real-time data updates
   - Pond-specific parameter monitoring

2. **Sensor Data Pages**
   - Temperature monitoring
   - pH level monitoring
   - Dissolved Oxygen (DOX) monitoring
   - Salinity monitoring
   - Humidity monitoring

3. **Reporting**
   - Generate PDF/CSV reports
   - Historical data analysis

4. **Authentication**
   - Login/logout functionality
   - User types management
   - Protected routes

5. **API Integration**
   - Axios-based API calls
   - Multiple endpoints (sensor_data, user)
   - Error handling and loading states

## Technical Requirements

### Framework & Lang

- Next.js 14+
- React 18+
- TypeScript (recommended)

### Styling

- TailwindCSS or Material-UI
- Migrate from SCSS

### State Management

- React Context API or Zustand

### UI Components

- Shadcn/ui or similar component library

### Charts/Visualizations

- Chart.js or Recharts (for sensor data viz)

### Form Handling

- React Hook Form with validation

### API Layer

- **SWR** for data fetching with automatic caching & revalidation
- Custom hooks wrapping SWR for domain-specific logic
- Mock data setup for presentation/development
- Easy migration to real API endpoints

## Mock Data Strategy

- **Complete mock dataset** for client-side presentation
- Support for 10+ ponds (scalable mock generator)
- Realistic sensor readings (temperature, pH, DOX, salinity, humidity)
- Mock authentication with different user roles
- API endpoint simulation using dynamic routes
- Easy switch to real backend without code changes

## File Structure

```
src/
  app/
    layout.tsx
    page.tsx
    dashboard/
      page.tsx
    [pond]/
      dashboard/
      temperature/
      ph/
      dox/
      salinity/
      humidity/
    reports/
    login/
    api/
      mock/           [Mock API routes]
  components/
  hooks/
  utils/
  constants/
  mocks/              [Mock data generators]
  styles/
```

## Migration Path

1. Set up Next.js project
2. Migrate constants and utilities
3. Create reusable components
4. Migrate pages sequentially
5. Update API integration
6. Testing & optimization

## Performance Goals

- LCP < 2.5s (support 10k concurrent users)
- CLS < 0.1
- FID < 100ms
- Optimize images (next/image)
- Code splitting for routes
- Real-time data updates via WebSocket/SSE
- Chart rendering optimization for 30+ data points

## Scalability for 10k+ Users

- Stateless component architecture
- Client-side caching with SWR
- Progressive data loading (paginated/infinite scroll)
- Real-time sensor data visualization
- Support for 10+ simultaneous dashboards

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## Success Criteria

- All features from Quasar port working
- Performance improved by 25%+
- Bundle size reduced
- 90+ Lighthouse score
- All tests passing

## Timeline

- Setup & Architecture: 1 week
- Component Migration: 3-4 weeks
- Integration & Testing: 2 weeks
- Optimization: 1 week
