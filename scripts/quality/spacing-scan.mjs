import ts from 'typescript';

export const SPACING_LONGHANDS = [
  'padding',
  'padding-inline',
  'padding-block',
  'padding-inline-start',
  'padding-inline-end',
  'padding-block-start',
  'padding-block-end',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-inline',
  'margin-block',
  'margin-inline-start',
  'margin-inline-end',
  'margin-block-start',
  'margin-block-end',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'gap',
  'row-gap',
  'column-gap',
  'grid-gap',
  'grid-row-gap',
  'grid-column-gap',
  'border-spacing',
  'text-indent',
  'scroll-margin',
  'scroll-padding',
];

const camelCase = (property) => property.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const TSX_SPACING_PROPERTIES = new Set(SPACING_LONGHANDS.map(camelCase));

function staticPropertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return undefined;
}

function unwrap(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function staticStyleValue(initializer, sourceFile) {
  const expression = unwrap(initializer);
  if (ts.isStringLiteralLike(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  if (ts.isNumericLiteral(expression)) return `${expression.text}px`;
  if (
    ts.isPrefixUnaryExpression(expression) &&
    ts.isNumericLiteral(expression.operand) &&
    (expression.operator === ts.SyntaxKind.MinusToken ||
      expression.operator === ts.SyntaxKind.PlusToken)
  ) {
    return `${expression.getText(sourceFile)}px`;
  }
  return undefined;
}

/**
 * Return statically-authored spacing values from React style objects in a TSX
 * file. Ordinary document models may also use names such as marginTop or gap;
 * those are not CSS and must not be treated as interface spacing.
 */
export function extractTsxSpacingDeclarations(fileName, sourceText) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const styleObjects = new Set();
  const referencedStyleObjects = new Set();

  const findStyleAttributes = (node) => {
    if (ts.isJsxAttribute(node) && staticPropertyName(node.name) === 'style') {
      const initializer = node.initializer;
      if (initializer && ts.isJsxExpression(initializer) && initializer.expression) {
        const expression = unwrap(initializer.expression);
        if (ts.isObjectLiteralExpression(expression)) styleObjects.add(expression);
        else if (ts.isIdentifier(expression)) referencedStyleObjects.add(expression.text);
      }
    }
    if (ts.isPropertyAssignment(node) && staticPropertyName(node.name) === 'style') {
      const expression = unwrap(node.initializer);
      if (ts.isObjectLiteralExpression(expression)) styleObjects.add(expression);
    }
    ts.forEachChild(node, findStyleAttributes);
  };
  findStyleAttributes(sourceFile);

  const findReferencedStyleObjects = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      referencedStyleObjects.has(node.name.text) &&
      node.initializer
    ) {
      const initializer = unwrap(node.initializer);
      if (ts.isObjectLiteralExpression(initializer)) styleObjects.add(initializer);
    }
    ts.forEachChild(node, findReferencedStyleObjects);
  };
  findReferencedStyleObjects(sourceFile);

  const declarations = [];
  for (const object of styleObjects) {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = staticPropertyName(property.name);
      if (!name || !TSX_SPACING_PROPERTIES.has(name)) continue;
      const value = staticStyleValue(property.initializer, sourceFile);
      if (value === undefined) continue;
      declarations.push({ property: name, value, index: property.getStart(sourceFile) });
    }
  }
  return declarations;
}
