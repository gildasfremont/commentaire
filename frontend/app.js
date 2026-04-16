document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("document");

  // Load the markdown document
  const response = await fetch("document.md");
  const markdown = await response.text();

  // Render markdown to HTML
  container.innerHTML = marked.parse(markdown);

  // Assign stable IDs to all paragraphs
  const paragraphs = container.querySelectorAll("p");
  paragraphs.forEach((p, index) => {
    p.id = `p-${index}`;
  });
});
