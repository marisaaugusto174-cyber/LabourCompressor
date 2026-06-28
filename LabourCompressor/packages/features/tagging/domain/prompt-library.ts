export interface PromptLibrarySection {
  readonly heading: string;
  readonly level: 2 | 3;
  readonly contentLines: readonly string[];
}

export interface PromptLibraryDocument {
  readonly title: string;
  readonly sections: readonly PromptLibrarySection[];
}

export function parsePromptLibraryMarkdown(
  markdown: string
): PromptLibraryDocument {
  const lines = markdown.split(/\r?\n/u);
  let title = 'Untitled Prompt Library';
  const sections: PromptLibrarySection[] = [];
  let currentSection: MutablePromptLibrarySection | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.trim().length === 0) {
      continue;
    }

    if (line.startsWith('# ') && title === 'Untitled Prompt Library') {
      title = line.slice(2).trim();
      continue;
    }

    const headingMatch = /^(##|###)\s+(.+)$/u.exec(line);

    if (headingMatch !== null) {
      if (currentSection !== undefined) {
        sections.push(freezeSection(currentSection));
      }

      currentSection = {
        heading: headingMatch[2]!.trim(),
        level: headingMatch[1] === '##' ? 2 : 3,
        contentLines: []
      };
      continue;
    }

    if (currentSection === undefined) {
      continue;
    }

    currentSection.contentLines.push(normalizePromptContentLine(line));
  }

  if (currentSection !== undefined) {
    sections.push(freezeSection(currentSection));
  }

  return Object.freeze({
    title,
    sections: Object.freeze(sections)
  });
}

export function buildPromptLibraryInstruction(
  document: PromptLibraryDocument
): string {
  const sectionBlocks = document.sections.map((section) => {
    const body = section.contentLines.join('\n');
    return `${section.heading}\n${body}`;
  });

  return [`Prompt Library: ${document.title}`, ...sectionBlocks].join('\n\n');
}

interface MutablePromptLibrarySection {
  heading: string;
  level: 2 | 3;
  contentLines: string[];
}

function freezeSection(
  section: MutablePromptLibrarySection
): PromptLibrarySection {
  return Object.freeze({
    heading: section.heading,
    level: section.level,
    contentLines: Object.freeze(section.contentLines)
  });
}

function normalizePromptContentLine(line: string): string {
  return line.replace(/^-\s+/u, '- ').trim();
}
