# Data format for input files
Tab delimited, at least 3 columns

Header row, if present should start with #


To be able to use blast output:
1. run sed commant to extract species name to a separate column
```sh

sed  -e 's/\]$//g' -e 's/\[Legionella/\tL./g' blast_output.txt > blast_output_processed.txt
```

2. Add header (make sure it's tab-separated after copy-paste)

>#sallacc	qacc	evalue	length	pident	qcovs	slen	seq.id	salltitles	species

