import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardMedia,
  CardTitle,
} from './Card';

describe('Card', () => {
  it('composes optional slots without adding empty regions', () => {
    render(
      <Card variant="interactive" density="compact">
        <CardHeader>
          <CardTitle>Recent project</CardTitle>
          <CardAction>Menu</CardAction>
        </CardHeader>
        <CardMedia data-testid="media">Preview</CardMedia>
        <CardContent>
          <CardDescription>A local document.</CardDescription>
        </CardContent>
        <CardFooter>Open</CardFooter>
      </Card>,
    );

    expect(screen.getByText('Recent project')).toBeInTheDocument();
    expect(screen.getByTestId('media')).toHaveClass('varve-card__media');
    expect(screen.getByText('Open')).toHaveClass('varve-card__footer');
    expect(screen.queryByTestId('missing-slot')).not.toBeInTheDocument();
  });

  it('keeps semantic element choice and state data on the root', () => {
    render(
      <Card as="article" selected disabled loading aria-label="Unavailable project">
        Project
      </Card>,
    );

    const card = screen.getByRole('article', { name: 'Unavailable project' });
    expect(card).toHaveAttribute('data-selected', 'true');
    expect(card).toHaveAttribute('data-disabled', 'true');
    expect(card).toHaveAttribute('data-loading', 'true');
    expect(card).toHaveAttribute('aria-disabled', 'true');
    expect(card).toHaveAttribute('aria-busy', 'true');
  });

  it('merges caller classes without changing the card contract', () => {
    render(<Card className="project-card">Project</Card>);
    expect(screen.getByText('Project')).toHaveClass('project-card');
    expect(screen.getByText('Project')).toHaveClass('varve-card--surface');
  });
});
