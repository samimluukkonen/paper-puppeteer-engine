const workspace = new URL('project/', window.location.href);
workspace.search = window.location.search;
workspace.hash = window.location.hash;
window.location.replace(workspace.href);
