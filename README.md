# Ng-Mapper
Dependency mapper for AngularJS which is able to find issues in dependencies of AngularJS projects.

# TODO
- Remove `--main-module` argument and read `ng-app` instead
- Export stats & graphs for dependencies in single HTML file
- Export single source file with stripped unused modules/components

# Arguments
### Main module & HTML (required)
`--main-module <module name>`
`--main-html <filepath>`

### Ignore paths
`--ignore-path <path1,path2,...>`

Ignore certain paths in your sources (example: lib)

### Show files next to warnings
`--warning-files`

Warnings will have files mentioned next to them

### Ignore selected warnings
`--ignore-warning <ignore1,ignore2,...>`

Ignore selected warnings. You will be still notified about total warning count at the end of processing.

List of warning types
- `multiple-registration` module or component name is registered multiple times
- `missing-template` unable to open file mentioned in templateUrl param
- `missing-dependency` component is dependent on module that is not injected to component's module
- `ignored-module` module is not used at all
- `ignored-component` component is not used at all
- `not-exist` components is dependent on module that does not exist

### Export hierarchy
`--export-hierarchy <filepath>`

Exports json file containing map of dependencies

TODO: This should be changed to single HTML file containing graphs with dependencies and issues